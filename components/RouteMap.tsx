/* eslint-disable @typescript-eslint/no-explicit-any -- Runtime adapter shares two unrelated mapping SDK object types. */
/* eslint-disable react-hooks/exhaustive-deps -- Map lifecycle follows key/route/mode; event callbacks read current props through a ref. */
"use client";
import { useEffect, useRef, useState } from "react";
import {
  groups,
  activeRouteColor,
  overlayColor,
  nearestSegment,
  type RouteData,
  type TrackPoint,
  type Waypoint,
} from "../lib/route";
import type * as Leaflet from "leaflet";
export type Mode = "browse" | "edit" | "append" | "waypoint";
type Props = {
  route: RouteData;
  mode: Mode;
  apiKey: string;
  focus: Waypoint | null;
  fitSignal: number;
  onPoints: (ps: TrackPoint[]) => void;
  onAdd: (p: TrackPoint) => void;
  onSelect: (w: Waypoint) => void;
  onMove: (id: string, p: TrackPoint) => void;
  onError: (s: string) => void;
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
    handles = useRef<any[]>([]),
    [ready, setReady] = useState(0),
    [provider, setProvider] = useState("載入地圖中…");
  useEffect(() => {
    state.current = props;
  }, [props]);
  const click = (p: TrackPoint) => {
    const s = state.current;
    if (s.mode === "waypoint") s.onAdd(p);
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
      bottom = Math.min(
        (host.current
          ?.closest(".canvas")
          ?.querySelector<HTMLElement>(".elevation-card")?.offsetHeight ??
          180) + 40,
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
    const el = host.current!;
    async function start() {
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
            mapTypeControl: true,
            streetViewControl: false,
            fullscreenControl: false,
            clickableIcons: false,
            styles: [{ featureType: "poi", stylers: [{ visibility: "off" }] }],
          });
          map.current.addListener("click", (e: any) =>
            click({ lat: e.latLng.lat(), lng: e.latLng.lng() }),
          );
          map.current.addListener("idle", renderHandles);
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
          map.current.on("moveend", renderHandles);
          setProvider("OpenStreetMap 備用底圖");
        }
        setReady((v) => v + 1);
        fit();
      } catch (e) {
        state.current.onError(e instanceof Error ? e.message : "無法載入地圖");
        setProvider("地圖載入失敗");
      }
    }
    void start();
    return () => {
      cancelled = true;
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
          layers.current.push(
            new window.google.maps.Polyline({
              map: map.current,
              path: ps,
              strokeColor: overlayColor(index),
              strokeWeight: 9,
              strokeOpacity: 0,
              clickable: false,
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
            }),
          );
        } else {
          layers.current.push(
            L.current!.polyline(
              ps.map((p) => [p.lat, p.lng]),
              {
                color: overlayColor(index),
                weight: 9,
                opacity: 0.75,
                dashArray: "12 8",
                interactive: false,
              },
            ).addTo(map.current),
          );
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
        layers.current.push(line);
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
  }, [props.route, props.mode, ready]);
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
  return (
    <div className="map-wrap">
      <div
        ref={host}
        className={"map mode-" + props.mode}
        aria-label="路線互動地圖"
      />
      <span className="provider">{provider}</span>
    </div>
  );
}
