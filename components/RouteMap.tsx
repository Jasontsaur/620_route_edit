/* eslint-disable @typescript-eslint/no-explicit-any -- Runtime adapter shares two unrelated mapping SDK object types. */
/* eslint-disable react-hooks/exhaustive-deps -- Map lifecycle follows key/route/mode; event callbacks read current props through a ref. */
"use client";
import { useEffect, useRef, useState } from "react";
import {
  groups,
  activeRouteColor,
  overlayColor,
  nearestSegment,
  routeMilestones,
  type RouteData,
  type TrackPoint,
  type Waypoint,
} from "../lib/route";
import type * as Leaflet from "leaflet";
import type { MapViewport } from "../lib/elevation";
import type { MileageReference } from "../lib/mileage";
import {
  wheelPixels,
  addWheelPixels,
  wheelZoomBatch,
  zoomCenter,
} from "../lib/map-interaction";
import { recordedPointAt } from "../lib/record-time";
export type Mode = "browse" | "edit" | "append" | "waypoint";
type Props = {
  route: RouteData;
  mileageReference: MileageReference;
  mode: Mode;
  apiKey: string;
  focus: Waypoint | null;
  fitSignal: number;
  onPoints: (ps: TrackPoint[]) => void;
  onAdd: (p: TrackPoint) => void;
  onSelect: (w: Waypoint) => void;
  onMove: (id: string, p: TrackPoint) => void;
  onError: (s: string) => void;
  onViewport: (viewport: MapViewport | null) => void;
};
declare global {
  interface Window {
    google: any;
    gm_authFailure?: () => void;
    __routeGoogleReady?: () => void;
  }
}
let googlePromise: Promise<void> | null = null;
function loadGoogle(key: string) {
  if (window.google?.maps) return Promise.resolve();
  if (googlePromise) return googlePromise;
  googlePromise = new Promise((resolve, reject) => {
    window.__routeGoogleReady = () => resolve();
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=__routeGoogleReady&language=zh-TW&region=TW`;
    s.async = true;
    s.onerror = () => {
      googlePromise = null;
      reject(Error("Google Maps 無法載入，請確認網路與金鑰。"));
    };
    document.head.appendChild(s);
  });
  return googlePromise;
}
export default function RouteMap(props: Props) {
  const host = useRef<HTMLDivElement>(null),
    state = useRef(props),
    map = useRef<any>(null),
    adapter = useRef<"google" | "osm">("osm"),
    L = useRef<typeof Leaflet | null>(null),
    layers = useRef<any[]>([]),
    lastViewport = useRef<MapViewport | null>(null),
    handles = useRef<any[]>([]),
    [ready, setReady] = useState(0),
    [mapType, setMapType] = useState<"roadmap" | "satellite" | "terrain">(
      "roadmap",
    ),
    [provider, setProvider] = useState("載入地圖中…"),
    [recordTip, setRecordTip] = useState<{
      x: number;
      y: number;
      name: string;
      clock: string;
      speedKmh?: number;
      speedSource?: "device" | "gps";
      power10sW?: number;
      pinned: boolean;
    } | null>(null);
  const timeFrame = useRef<number | null>(null);
  const pinnedTimeTip = useRef(false);
  useEffect(() => {
    state.current = props;
  }, [props]);
  const click = (p: TrackPoint) => {
    const s = state.current;
    if (s.mode === "browse") {
      pinnedTimeTip.current = false;
      setRecordTip(null);
    } else if (s.mode === "waypoint") s.onAdd(p);
    else if (s.mode === "append")
      s.onPoints([
        ...s.route.points,
        { ...p, segment: s.route.points.at(-1)?.segment ?? 0 },
      ]);
    else if (s.mode === "edit") {
      const i = nearestSegment(s.route.points, p),
        ps = [...s.route.points];
      ps.splice(i, 0, { ...p, segment: ps[Math.max(0, i - 1)]?.segment ?? 0 });
      s.onPoints(ps);
    }
  };

  function bindRecordingTime(line: any, points: TrackPoint[], name: string) {
    if (!points.some((p) => p.recordedTime)) return;
    const google = adapter.current === "google";
    const show = (event: any, pinned: boolean) => {
      if (state.current.mode !== "browse" || (!pinned && pinnedTimeTip.current))
        return;
      const location = google
        ? { lat: event.latLng.lat(), lng: event.latLng.lng() }
        : { lat: event.latlng.lat, lng: event.latlng.lng };
      const mouse = google ? event.domEvent : event.originalEvent;
      const bounds = host.current!.getBoundingClientRect();
      const x = Math.max(
        8,
        Math.min(
          bounds.width - 228,
          (mouse?.clientX ?? bounds.left + bounds.width / 2) - bounds.left + 14,
        ),
      );
      const y = Math.max(
        8,
        Math.min(
          bounds.height - 145,
          (mouse?.clientY ?? bounds.top + bounds.height / 2) - bounds.top + 14,
        ),
      );
      if (timeFrame.current !== null) cancelAnimationFrame(timeFrame.current);
      const update = () => {
        timeFrame.current = null;
        const point = recordedPointAt(points, location);
        pinnedTimeTip.current = Boolean(pinned && point?.recordedTime);
        setRecordTip(
          point?.recordedTime
            ? {
                x,
                y,
                name,
                clock: point.recordedTime,
                speedKmh: point.recordedSpeedKmh,
                speedSource: point.speedSource,
                power10sW: point.recordedPower10sW,
                pinned,
              }
            : null,
        );
      };
      if (pinned) {
        event.stop?.();
        update();
      } else timeFrame.current = requestAnimationFrame(update);
    };
    const leave = () => {
      if (timeFrame.current !== null) cancelAnimationFrame(timeFrame.current);
      timeFrame.current = null;
      setRecordTip((previous) => (previous?.pinned ? previous : null));
    };
    if (google) {
      line.addListener("mousemove", (event: any) => show(event, false));
      line.addListener("mouseout", leave);
      line.addListener("click", (event: any) => show(event, true));
    } else {
      line.on("mousemove", (event: Leaflet.LeafletMouseEvent) =>
        show(event, false),
      );
      line.on("mouseout", leave);
      line.on("click", (event: Leaflet.LeafletMouseEvent) => show(event, true));
    }
  }
  useEffect(() => {
    pinnedTimeTip.current = false;
    void Promise.resolve().then(() => setRecordTip(null));
    return () => {
      if (timeFrame.current !== null) cancelAnimationFrame(timeFrame.current);
      timeFrame.current = null;
    };
  }, [props.route, props.mode]);

  function publishViewport() {
    const bounds = map.current?.getBounds();
    if (!bounds) return;
    const sw = bounds.getSouthWest(),
      ne = bounds.getNorthEast();
    const viewport =
      adapter.current === "google"
        ? { south: sw.lat(), west: sw.lng(), north: ne.lat(), east: ne.lng() }
        : { south: sw.lat, west: sw.lng, north: ne.lat, east: ne.lng };
    const previous = lastViewport.current;
    if (
      previous &&
      (Object.keys(viewport) as (keyof MapViewport)[]).every(
        (key) => Math.abs(viewport[key] - previous[key]) < 1e-9,
      )
    )
      return;
    lastViewport.current = viewport;
    state.current.onViewport(viewport);
  }

  function clear(which: React.RefObject<any[]>) {
    which.current.forEach((x) =>
      adapter.current === "google" ? x.setMap(null) : x.remove(),
    );
    which.current = [];
  }
  function fit() {
    if (!map.current) return;
    const route = state.current.route,
      ps = [
        ...route.points,
        ...(route.overlays ?? []).flatMap((layer) => layer.points),
      ],
      height = host.current?.clientHeight ?? 650,
      card = host.current
        ?.closest(".canvas")
        ?.querySelector<HTMLElement>(".elevation-card"),
      bottom = Math.min(
        (card && getComputedStyle(card).position === "absolute"
          ? card.offsetHeight
          : 0) + 40,
        height * 0.6,
      ),
      top = Math.min(65, height * 0.15);
    if (adapter.current === "google") {
      const b = new window.google.maps.LatLngBounds();
      ps.forEach((p) => b.extend(p));
      map.current.fitBounds(b, { top, bottom, left: 45, right: 45 });
    } else
      map.current.fitBounds(
        ps.map((p) => [p.lat, p.lng]),
        { paddingTopLeft: [45, top], paddingBottomRight: [45, bottom] },
      );
  }
  function renderHandles() {
    if (!map.current) return;
    clear(handles);
    if (state.current.mode !== "edit") return;
    const ps = state.current.route.points,
      bounds = map.current.getBounds();
    const indices = ps
      .map((p, i) => ({ p, i }))
      .filter(({ p }) =>
        adapter.current === "google"
          ? bounds?.contains(p)
          : bounds?.contains([p.lat, p.lng]),
      );
    if (indices.length > 180) return;
    indices.forEach(({ p, i }) => {
      const move = (lat: number, lng: number) => {
        const next = [...state.current.route.points];
        next[i] = { lat, lng, segment: next[i].segment };
        state.current.onPoints(next);
      };
      const remove = () => {
        if (state.current.route.points.length <= 2) return;
        state.current.onPoints(
          state.current.route.points.filter((_, j) => j !== i),
        );
      };
      if (adapter.current === "google") {
        const marker = new window.google.maps.Marker({
          map: map.current,
          position: p,
          draggable: true,
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: 4,
            fillColor: "#fff",
            fillOpacity: 1,
            strokeColor: "#ef5b35",
            strokeWeight: 2,
          },
          title: "拖曳修改；右鍵刪除",
        });
        marker.addListener("dragend", (e: any) =>
          move(e.latLng.lat(), e.latLng.lng()),
        );
        marker.addListener("rightclick", remove);
        handles.current.push(marker);
      } else {
        const marker = L.current!.marker([p.lat, p.lng], {
          draggable: true,
          icon: L.current!.divIcon({
            className: "vertex",
            iconSize: [10, 10],
            iconAnchor: [5, 5],
          }),
        }).addTo(map.current);
        marker.on("dragend", () => {
          const c = marker.getLatLng();
          move(c.lat, c.lng);
        });
        marker.on("contextmenu", remove);
        handles.current.push(marker);
      }
    });
  }
  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | undefined;
    let wheelTimer: ReturnType<typeof setTimeout> | undefined;
    let pendingWheel = 0,
      lastWheel = 0,
      wheelPoint = { x: 0, y: 0 };
    const el = host.current!;
    const onWheel = (event: WheelEvent) => {
      if (
        !map.current ||
        event.ctrlKey ||
        event.metaKey ||
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
      )
        return;
      const pixels = wheelPixels(event.deltaY, event.deltaMode);
      if (!pixels) return;
      event.preventDefault();
      event.stopPropagation();
      const now = performance.now();
      if (now - lastWheel > 200) pendingWheel = 0;
      lastWheel = now;
      pendingWheel = addWheelPixels(pendingWheel, pixels);
      const bounds = el.getBoundingClientRect();
      wheelPoint = {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      };
      if (wheelTimer !== undefined) return;
      wheelTimer = setTimeout(() => {
        wheelTimer = undefined;
        if (cancelled || !map.current) return;
        const currentZoom = map.current.getZoom();
        if (typeof currentZoom !== "number") return;
        const google = adapter.current === "google";
        const min = google
          ? (map.current.get("minZoom") ?? 0)
          : map.current.getMinZoom();
        const max = google
          ? (map.current.get("maxZoom") ??
            map.current.mapTypes.get(map.current.getMapTypeId())?.maxZoom ??
            21)
          : map.current.getMaxZoom();
        const next = wheelZoomBatch(pendingWheel, currentZoom, min, max);
        pendingWheel = next.remainder;
        if (next.zoom === currentZoom) return;
        if (google) {
          const projection = map.current.getProjection();
          const center = map.current.getCenter();
          if (projection && center) {
            const current = projection.fromLatLngToPoint(center);
            const target = zoomCenter(
              current,
              {
                x: wheelPoint.x - el.clientWidth / 2,
                y: wheelPoint.y - el.clientHeight / 2,
              },
              currentZoom,
              next.zoom,
            );
            map.current.moveCamera({
              zoom: next.zoom,
              center: projection.fromPointToLatLng(
                new window.google.maps.Point(target.x, target.y),
              ),
            });
          } else map.current.setZoom(next.zoom);
        } else {
          map.current.setZoomAround([wheelPoint.x, wheelPoint.y], next.zoom, {
            animate: false,
          });
        }
      }, 40);
    };
    async function start() {
      lastViewport.current = null;
      state.current.onViewport(null);
      try {
        if (props.apiKey) {
          window.gm_authFailure = () => {
            state.current.onError(
              "Google Maps 金鑰驗證失敗；請檢查 API 與網站限制，清除金鑰可使用備用底圖。",
            );
            setProvider("Google Maps 驗證失敗");
          };
          await loadGoogle(props.apiKey);
          if (cancelled) return;
          adapter.current = "google";
          map.current = new window.google.maps.Map(el, {
            center: { lat: 23.7, lng: 120.9 },
            zoom: 7,
            isFractionalZoomEnabled: true,
            tilt: 0,
            heading: 0,
            scrollwheel: false,
            mapTypeId: mapType,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
            clickableIcons: false,
            styles: [{ featureType: "poi", stylers: [{ visibility: "off" }] }],
          });
          map.current.addListener("click", (e: any) =>
            click({ lat: e.latLng.lat(), lng: e.latLng.lng() }),
          );
          map.current.addListener("idle", () => {
            renderHandles();
            publishViewport();
          });
          setProvider("Google Maps");
        } else {
          const leaflet = await import("leaflet");
          if (cancelled) return;
          L.current = leaflet;
          adapter.current = "osm";
          map.current = leaflet
            .map(el, {
              zoomControl: false,
              doubleClickZoom: false,
              scrollWheelZoom: false,
              zoomSnap: 0.5,
              zoomDelta: 0.5,
              // Leaflet ignores subsequent wheel updates while a CSS zoom
              // animation is active. Apply the smaller steps immediately.
              zoomAnimation: false,
            })
            .setView([23.7, 120.9], 7);
          leaflet
            .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
              attribution:
                '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
              maxZoom: 19,
            })
            .addTo(map.current);
          leaflet.control.zoom({ position: "bottomright" }).addTo(map.current);
          map.current.on("click", (e: Leaflet.LeafletMouseEvent) =>
            click({ lat: e.latlng.lat, lng: e.latlng.lng }),
          );
          map.current.on("moveend", () => {
            renderHandles();
            publishViewport();
          });
          setProvider("OpenStreetMap 備用底圖");
        }

        el.addEventListener("wheel", onWheel, {
          passive: false,
          capture: true,
        });
        resizeObserver = new ResizeObserver(() => {
          if (!map.current || cancelled) return;
          if (adapter.current === "osm")
            map.current.invalidateSize({ pan: false });
          else window.google.maps.event.trigger(map.current, "resize");
          publishViewport();
        });
        resizeObserver.observe(el);

        setReady((v) => v + 1);
        fit();
        publishViewport();
      } catch (e) {
        state.current.onError(e instanceof Error ? e.message : "無法載入地圖");
        setProvider("地圖載入失敗");
      }
    }
    void start();
    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      el.removeEventListener("wheel", onWheel, { capture: true });
      if (wheelTimer !== undefined) clearTimeout(wheelTimer);
      if (map.current) {
        clear(layers);
        clear(handles);
        if (adapter.current === "osm") {
          map.current.stop();
          map.current.remove();
        } else window.google.maps.event.clearInstanceListeners(map.current);
        map.current = null;
      }
      el.replaceChildren();
    };
  }, [props.apiKey]);
  useEffect(() => {
    if (!ready || !map.current) return;
    clear(layers);
    const s = props;
    // Wide, dashed reference strokes remain visible beneath coincident active tracks.
    (s.route.overlays ?? []).forEach((layer, index) => {
      groups(layer.points).forEach((ps) => {
        if (adapter.current === "google") {
          const line = new window.google.maps.Polyline({
            map: map.current,
            path: ps,
            strokeColor: overlayColor(index),
            strokeWeight: 9,
            strokeOpacity: 0,
            clickable: s.mode === "browse" && ps.some((p) => p.recordedTime),
            geodesic: true,
            zIndex: index,
            icons: [
              {
                icon: {
                  path: "M 0,-1 0,1",
                  strokeColor: overlayColor(index),
                  strokeOpacity: 0.8,
                  strokeWeight: 9,
                  scale: 3,
                },
                offset: "0",
                repeat: "20px",
              },
            ],
          });
          bindRecordingTime(line, ps, layer.name);
          layers.current.push(line);
        } else {
          const line = L.current!.polyline(
            ps.map((p) => [p.lat, p.lng]),
            {
              color: overlayColor(index),
              weight: 9,
              opacity: 0.75,
              dashArray: "12 8",
              interactive:
                s.mode === "browse" && ps.some((p) => p.recordedTime),
              bubblingMouseEvents: false,
            },
          ).addTo(map.current);
          bindRecordingTime(line, ps, layer.name);
          layers.current.push(line);
        }
      });
    });
    groups(s.route.points).forEach((ps) => {
      if (adapter.current === "google") {
        const line = new window.google.maps.Polyline({
          map: map.current,
          path: ps,
          strokeColor: activeRouteColor,
          strokeWeight: 4,
          strokeOpacity: 0.95,
          clickable: true,
          geodesic: true,
          zIndex: 10,
        });
        line.addListener("click", (e: any) =>
          click({ lat: e.latLng.lat(), lng: e.latLng.lng() }),
        );
        bindRecordingTime(line, ps, s.route.name);
        layers.current.push(line);
      } else {
        const line = L.current!.polyline(
          ps.map((p) => [p.lat, p.lng]),
          {
            color: activeRouteColor,
            weight: 4,
            opacity: 0.95,
            bubblingMouseEvents: false,
          },
        ).addTo(map.current);
        line.on("click", (e: Leaflet.LeafletMouseEvent) =>
          click({ lat: e.latlng.lat, lng: e.latlng.lng }),
        );
        bindRecordingTime(line, ps, s.route.name);
        layers.current.push(line);
      }
    });

    routeMilestones(s.mileageReference.points).forEach((p) => {
      const label = String(p.meters / 1000);
      const title = `四極點620：${label} 公里`;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="68" height="32" viewBox="0 0 68 32"><path d="M34 23v6" stroke="#1769c2" stroke-width="2"/><circle cx="34" cy="29" r="2.5" fill="#1769c2" stroke="white"/><rect x="1" y="1" width="66" height="22" rx="11" fill="white" stroke="#1769c2" stroke-width="2"/><text x="34" y="16" text-anchor="middle" fill="#153e55" font-family="Arial,sans-serif" font-size="12" font-weight="700">${label}</text></svg>`;
      if (adapter.current === "google") {
        layers.current.push(
          new window.google.maps.Marker({
            map: map.current,
            position: p,
            title,
            clickable: false,
            draggable: false,
            zIndex: 20,
            icon: {
              url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
              scaledSize: new window.google.maps.Size(68, 32),
              anchor: new window.google.maps.Point(34, 29),
            },
          }),
        );
      } else {
        layers.current.push(
          L.current!.marker([p.lat, p.lng], {
            title,
            interactive: false,
            keyboard: false,
            zIndexOffset: -100,
            icon: L.current!.divIcon({
              className: "distance-marker",
              html: svg,
              iconSize: [68, 32],
              iconAnchor: [34, 29],
            }),
          }).addTo(map.current),
        );
      }
    });

    s.route.waypoints.forEach((w) => {
      const label =
        w.id === "start"
          ? "S"
          : w.id === "finish"
            ? "F"
            : /^cp[1-6]$/.test(w.id)
              ? w.id.slice(2)
              : "•";
      if (adapter.current === "google") {
        const m = new window.google.maps.Marker({
          map: map.current,
          position: w,
          draggable: s.mode === "waypoint",
          title: w.name,
          label: { text: label, color: "#fff", fontSize: "12px" },
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: 12,
            fillColor: w.kind === "checkpoint" ? "#153e55" : "#c84e2c",
            fillOpacity: 1,
            strokeColor: "#fff",
            strokeWeight: 2,
          },
        });
        m.addListener("click", () => state.current.onSelect(w));
        m.addListener("dragend", (e: any) =>
          state.current.onMove(w.id, {
            lat: e.latLng.lat(),
            lng: e.latLng.lng(),
          }),
        );
        layers.current.push(m);
      } else {
        const m = L.current!.marker([w.lat, w.lng], {
          draggable: s.mode === "waypoint",
          icon: L.current!.divIcon({
            className:
              "station-marker " + (w.kind === "checkpoint" ? "" : "custom"),
            html: label,
            iconSize: [28, 28],
            iconAnchor: [14, 14],
          }),
        }).addTo(map.current);
        const tip = document.createElement("span");
        tip.textContent = w.name;
        m.bindTooltip(tip, { direction: "top", offset: [0, -12] });
        m.on("click", () => state.current.onSelect(w));
        m.on("dragend", () => {
          const c = m.getLatLng();
          state.current.onMove(w.id, { lat: c.lat, lng: c.lng });
        });
        layers.current.push(m);
      }
    });
    renderHandles();
  }, [props.route, props.mileageReference, props.mode, ready]);
  useEffect(() => {
    if (ready) fit();
  }, [props.fitSignal, ready]);
  useEffect(() => {
    if (!ready || !map.current || !props.focus) return;
    const p = props.focus;
    if (adapter.current === "google") {
      map.current.panTo(p);
      map.current.setZoom(15);
    } else map.current.setView([p.lat, p.lng], 15);
  }, [props.focus, ready]);
  useEffect(() => {
    if (ready && map.current && adapter.current === "google") {
      map.current.setMapTypeId(mapType);
    }
  }, [mapType, ready]);
  return (
    <div
      className="map-wrap"
      data-provider={provider === "Google Maps" ? "google" : "osm"}
    >
      <div
        ref={host}
        className={"map mode-" + props.mode}
        aria-label="路線互動地圖"
      />
      {provider === "Google Maps" && (
        <label className="map-type-control">
          <select
            aria-label="Google Maps 顯示模式"
            value={mapType}
            onChange={(e) =>
              setMapType(
                e.target.value === "terrain"
                  ? "terrain"
                  : e.target.value === "satellite"
                    ? "satellite"
                    : "roadmap",
              )
            }
          >
            <option value="roadmap">地圖</option>
            <option value="satellite">衛星</option>
            <option value="terrain">地形</option>
          </select>
        </label>
      )}
      {recordTip && (
        <div
          className="record-time-tooltip"
          style={{ left: recordTip.x, top: recordTip.y }}
          role="status"
          aria-live="polite"
        >
          <small>{recordTip.name}</small>
          <strong>{recordTip.clock}</strong>
          <dl className="record-metrics">
            <div>
              <dt>
                速度{recordTip.speedSource === "gps" ? "（GPS估算）" : ""}
              </dt>
              <dd>
                {recordTip.speedKmh === undefined
                  ? "無速度資料"
                  : recordTip.speedKmh.toFixed(1) + " km/h"}
              </dd>
            </div>
            <div>
              <dt>10秒平均功率</dt>
              <dd>
                {recordTip.power10sW === undefined
                  ? "資料不足"
                  : Math.round(recordTip.power10sW) + " W"}
              </dd>
            </div>
          </dl>
          <span>最近紀錄點 · 台灣時間</span>
        </div>
      )}
      <span className="provider">{provider}</span>
    </div>
  );
}
