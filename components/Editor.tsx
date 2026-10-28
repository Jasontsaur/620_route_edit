"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Route,
  MapPin,
  History,
  Upload,
  Download,
  Save,
  Undo2,
  Redo2,
  Settings,
  Maximize,
  MousePointer2,
  Plus,
  ChevronRight,
  X,
  ExternalLink,
  Flag,
  Check,
  Info,
  Cloud,
} from "lucide-react";
import RouteMap, { type Mode } from "./RouteMap";
import ElevationProfile from "./ElevationProfile";
import { importRouteFile } from "../lib/import-client";
import { SharedRouteClient, CloudSaveError } from "../lib/shared-client";
import type { SaveAction } from "../lib/shared-store";
import type { ImportSummary } from "../lib/compact-import";
import type { MapViewport } from "../lib/elevation";
import Dialogs, { type Panel } from "./Dialogs";
import {
  builtInRoute,
  addImportedRoute,
  activeRouteColor,
  overlayColor,
  distance,
  groups,
  officialUrl,
  validateRoute,
  type RouteData,
  type Waypoint,
  type TrackPoint,
} from "../lib/route";
import { download, exportFit, exportGpx, exportTcx } from "../lib/files";
type Version = {
  id: string;
  name: string;
  note: string;
  created: string;
  parent?: string;
  distance: number;
};
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
export const clock = (s: string) =>
  new Date(s).toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
const kinds = {
  checkpoint: "檢錄點",
  water: "補水",
  food: "補給",
  rest: "休息",
  custom: "自訂",
};
const modeHelp = {
  browse: "拖曳地圖瀏覽，點選站點查看詳情",
  edit: "放大至路段，拖曳白色節點；點擊插入，右鍵刪除。修改以直線連接。",
  append: "點擊地圖，依序延伸路線末端。新路段以直線連接。",
  waypoint: "點擊地圖新增點位，或拖曳既有點位調整位置",
};
import {
  referenceWaypoints,
  mileageSpan,
  type MileageReference,
} from "../lib/mileage";

export default function Editor() {
  const storageName =
    typeof window !== "undefined" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)
      ? "本機"
      : "雲端";
  const [route, setRoute] = useState<RouteData | null>(null),
    [mileageReference, setMileageReference] = useState<MileageReference | null>(
      null,
    ),
    [mode, setMode] = useState<Mode>("browse"),
    [tab, setTab] = useState<"points" | "versions">("points"),
    [panel, setPanel] = useState<Panel>(null),
    [selected, setSelected] = useState<Waypoint | null>(null),
    [focus, setFocus] = useState<Waypoint | null>(null),
    [fit, setFit] = useState(0),
    [panelExpanded, setPanelExpanded] = useState({
      legend: false,
      elevation: false,
    }),
    [viewport, setViewport] = useState<MapViewport | null>(null),
    [apiKey, setApiKey] = useState(""),
    [managementToken, setManagementToken] = useState(""),
    [mapsConfigStatus, setMapsConfigStatus] = useState<
      "loading" | "server" | "legacy" | "missing" | "error"
    >("loading"),
    [versions, setVersions] = useState<Version[]>([]),
    [versionError, setVersionError] = useState(""),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [canEdit, setCanEdit] = useState(false),
    [publicEdit, setPublicEdit] = useState(false),
    [syncState, setSyncState] = useState<
      "loading" | "saved" | "dirty" | "saving" | "error" | "conflict"
    >("loading"),
    [syncError, setSyncError] = useState(""),
    [updated, setUpdated] = useState<string | null>(null),
    [legacy, setLegacy] = useState(false),
    [editingLink, setEditingLink] = useState(""),
    [versionTick, setVersionTick] = useState(0),
    [undoReady, setUndoReady] = useState(false),
    [redoReady, setRedoReady] = useState(false),
    [compare, setCompare] = useState<Version | null>(null);
  const file = useRef<HTMLInputElement>(null),
    past = useRef<RouteData[]>([]),
    future = useRef<RouteData[]>([]),
    current = useRef<RouteData | null>(null),
    editorEnabled = useRef(false),
    cloud = useRef(new SharedRouteClient()),
    saving = useRef<Promise<boolean> | null>(null),
    queued = useRef<SaveAction>("autosave");
  const closePanel = useCallback(() => setPanel(null), []);
  const edit = (next: RouteData) => {
    if (!editorEnabled.current) return;
    if (current.current) {
      past.current.push(clone(current.current));
      if (past.current.length > 35) past.current.shift();
    }
    future.current = [];
    current.current = next;
    setRoute(next);
    setDirty(true);
    setSyncState((s) =>
      s === "error" || s === "conflict" || s === "saving" ? s : "dirty",
    );
    setUndoReady(past.current.length > 0);
    setRedoReady(future.current.length > 0);
  };
  function loadVersions() {
    setVersionTick((v) => v + 1);
  }
  useEffect(() => {
    let active = true;
    const routeToken =
      new URLSearchParams(location.hash.slice(1)).get("route-edit") ??
      undefined;
    if (routeToken)
      history.replaceState(null, "", location.pathname + location.search);

    Promise.all(
      [
        { url: "/data/twb-2026.json", label: "TWB 四極點620" },
        { url: "/data/520-activity-slim.json", label: "520 騎乘紀錄（瘦身）" },
      ].map(async ({ url, label }) => {
        const response = await fetch(url);
        if (!response.ok) throw Error(`${label} 預設路線載入失敗`);
        return response.json();
      }),
    )
      .then(async ([official, ride]) => {
        if (active) {
          const reference = validateRoute(official);
          setMileageReference({
            name: reference.name,
            points: reference.points,
          });
          const fallback = builtInRoute(official, ride);
          try {
            const shared = await cloud.current.load(routeToken);
            if (!active) return;
            const next = shared.route ?? fallback;
            current.current = next;
            setRoute(next);
            editorEnabled.current = shared.canEdit;
            setCanEdit(shared.canEdit);
            setPublicEdit(shared.publicEdit);
            setUpdated(shared.updated);
            setSyncState("saved");
          } catch (e) {
            if (!active) return;
            current.current = fallback;
            setRoute(fallback);
            setSyncState("error");
            setSyncError(e instanceof Error ? e.message : "共用路線讀取失敗。");
          }
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    const captureSetup = () => {
      if (new URLSearchParams(location.hash.slice(1)).get("route-edit")) {
        // Opening an editing link in an existing tab may only change its hash.
        // A real reload consumes it through the same initialization path.
        location.reload();
        return;
      }
      const setupToken = new URLSearchParams(location.hash.slice(1)).get(
        "maps-setup",
      );
      if (!setupToken) return;
      // Fragments are not sent to the server. Remove it immediately and keep
      // it only in page memory. Handle a management link opened in this tab.
      history.replaceState(null, "", location.pathname + location.search);
      void Promise.resolve().then(() => {
        if (active) {
          setManagementToken(setupToken);
          setPanel("settings");
        }
      });
    };
    captureSetup();
    window.addEventListener("hashchange", captureSetup);
    // Prefer the shared backend key. Read legacy local storage only as a
    // migration fallback, after the server request has completed.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const legacyKey = () => {
      try {
        return localStorage.getItem("620-google-key")?.trim() ?? "";
      } catch {
        return "";
      }
    };
    fetch("/api/maps-config", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw Error("地圖設定讀取失敗");
        const config = (await response.json()) as { apiKey?: unknown };
        if (!config || typeof config.apiKey !== "string")
          throw Error("地圖設定格式錯誤");
        if (!active) return;
        const serverKey = config.apiKey.trim();
        const previousKey = legacyKey();
        setApiKey(serverKey || previousKey);
        setMapsConfigStatus(
          serverKey ? "server" : previousKey ? "legacy" : "missing",
        );
      })
      .catch(() => {
        if (!active) return;
        const previousKey = legacyKey();
        setApiKey(previousKey);
        setMapsConfigStatus(previousKey ? "legacy" : "error");
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
      window.removeEventListener("hashchange", captureSetup);
    };
  }, []);
  useEffect(() => {
    let active = true;
    fetch(legacy ? "/api/versions" : "/api/shared-route/versions", {
      cache: "no-store",
    })
      .then(async (r) => {
        const d = (await r.json()) as { error?: string; versions: Version[] };
        if (!r.ok) throw Error(d.error);
        if (active) {
          setVersions(d.versions);
          setVersionError("");
        }
      })
      .catch((e) => {
        if (active) setVersionError(e.message);
      });
    return () => {
      active = false;
    };
  }, [legacy, versionTick]);
  const persist = useCallback(async (manualNote?: string): Promise<boolean> => {
    if (saving.current || !editorEnabled.current || !current.current)
      return false;
    const client = cloud.current;
    const sentRoute = client.pending?.route ?? current.current;
    const action =
      client.pending?.action ??
      (manualNote !== undefined ? "snapshot" : queued.current);
    const note = client.pending?.note ?? manualNote ?? "";
    if (!client.pending) queued.current = "autosave";
    setSyncState("saving");
    setSyncError("");
    const task = (async () => {
      try {
        const ack = await client.save(sentRoute, action, note);
        setUpdated(ack.updated);
        const stillDirty = current.current !== sentRoute;
        setDirty(stillDirty);
        setSyncState(stillDirty ? "dirty" : "saved");
        if (action !== "autosave") setVersionTick((v) => v + 1);
        return true;
      } catch (e) {
        setSyncError(e instanceof Error ? e.message : "自動儲存失敗，請重試。");
        setSyncState(
          e instanceof CloudSaveError && e.status === 409
            ? "conflict"
            : "error",
        );
        return false;
      } finally {
        saving.current = null;
      }
    })();
    saving.current = task;
    return task;
  }, []);
  useEffect(() => {
    if (!dirty || !canEdit || busy || syncState !== "dirty") return;
    const timer = setTimeout(
      () => void persist(),
      queued.current === "autosave" ? 1200 : 0,
    );
    return () => clearTimeout(timer);
  }, [route, dirty, canEdit, busy, syncState, persist]);
  useEffect(() => {
    const handle = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handle);
    return () => window.removeEventListener("beforeunload", handle);
  }, [dirty]);
  function undo() {
    if (!editorEnabled.current || !past.current.length || !current.current)
      return;
    future.current.push(clone(current.current));
    current.current = past.current.pop()!;
    setRoute(current.current);
    setDirty(true);
    setSyncState((s) =>
      s === "error" || s === "conflict" || s === "saving" ? s : "dirty",
    );
    setUndoReady(past.current.length > 0);
    setRedoReady(future.current.length > 0);
  }
  function redo() {
    if (!editorEnabled.current || !future.current.length || !current.current)
      return;
    past.current.push(clone(current.current));
    current.current = future.current.pop()!;
    setRoute(current.current);
    setDirty(true);
    setSyncState((s) =>
      s === "error" || s === "conflict" || s === "saving" ? s : "dirty",
    );
    setUndoReady(past.current.length > 0);
    setRedoReady(future.current.length > 0);
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input,textarea,select")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  function onPoints(points: TrackPoint[]) {
    if (route)
      edit({
        ...route,
        points,
        provenance: route.provenance.includes("使用者編輯")
          ? route.provenance
          : route.provenance + "；使用者編輯",
      });
  }
  function onAdd(p: TrackPoint) {
    setSelected({
      ...p,
      id: crypto.randomUUID(),
      name: "新增點位",
      kind: "custom",
      note: "",
    });
    setPanel("point");
  }
  function select(w: Waypoint) {
    setSelected(clone(w));
    setFocus({ ...w });
    setPanel("point");
  }
  function move(id: string, p: TrackPoint) {
    if (route)
      edit({
        ...route,
        waypoints: route.waypoints.map((w) =>
          w.id === id ? { ...w, ...p, accuracy: "使用者調整位置" } : w,
        ),
      });
  }
  async function importSelected(f: File) {
    if (!editorEnabled.current) return;
    setBusy(true);
    setError("");
    try {
      let summary: ImportSummary | undefined;
      const next = await importRouteFile(f, (p) => {
        setMessage(p.message);
        if (p.summary) summary = p.summary;
      });
      const restoreBackup = f.name.toLowerCase().endsWith(".json");
      if (
        restoreBackup &&
        dirty &&
        !window.confirm("要載入 JSON 備份？目前修改可用復原返回。")
      )
        return;
      queued.current = "import";
      edit(
        current.current
          ? addImportedRoute(current.current, next, restoreBackup)
          : next,
      );
      setFocus(null);
      setMode("browse");
      setFit((v) => v + 1);
      setMessage(
        `已匯入 ${f.name}：${summary ? `自動瘦身 ${summary.before.toLocaleString()} → ${summary.after.toLocaleString()} 個軌跡點。` : `${next.points.length.toLocaleString()} 個軌跡點。`}${restoreBackup ? "已還原備份的路線圖層。" : "原路線已保留為參考圖層；橘色為目前編輯路線。"}`,
      );
    } catch (e) {
      setMessage("");
      setError(e instanceof Error ? e.message : "匯入失敗");
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  }
  async function save(note: string) {
    if (!route || busy || !editorEnabled.current || syncState === "conflict")
      return;
    setBusy(true);
    setError("");
    try {
      if (saving.current && !(await saving.current)) return;
      if (cloud.current.pending && !(await persist())) return;
      if (!(await persist(note))) return;
      setPanel(null);
      setMessage("已建立共用歷史版本；最新路線也已自動保存。");
    } catch (e) {
      setError(e instanceof Error ? e.message : "儲存失敗");
    } finally {
      setBusy(false);
    }
  }
  async function restore(v: Version) {
    if (!editorEnabled.current) return;
    if (
      legacy &&
      !window.confirm(
        "此為舊版私人版本。載入後會自動保存為全站共用路線，所有訪客都能看到。要載入並共用？",
      )
    )
      return;
    if (
      dirty &&
      !window.confirm("目前有未儲存的修改。要載入此版本？可用復原返回。")
    )
      return;
    setBusy(true);
    try {
      const r = await fetch(
          (legacy ? "/api/versions?id=" : "/api/shared-route/versions?id=") +
            encodeURIComponent(v.id),
        ),
        d = (await r.json()) as { error?: string; route: RouteData };
      if (!r.ok) throw Error(d.error);
      queued.current = "restore";
      edit(validateRoute(d.route));
      setFit((x) => x + 1);
      setMessage("已載入版本，正在保存為最新共用路線；原歷史版本仍保留。");
    } catch (e) {
      setError(e instanceof Error ? e.message : "載入失敗");
    } finally {
      setBusy(false);
    }
  }
  async function exportAs(format: "fit" | "tcx" | "gpx" | "json") {
    if (!route || !mileageReference) return;
    setBusy(true);
    try {
      const name = route.name.replace(/[<>:"/\\|?*]/g, "-");
      if (format === "fit")
        download(
          await exportFit(route),
          name + ".fit",
          "application/octet-stream",
        );
      else
        download(
          format === "gpx"
            ? exportGpx(route)
            : format === "tcx"
              ? exportTcx(route)
              : JSON.stringify(route, null, 2),
          name + "." + format,
          format === "json" ? "application/json" : "application/xml",
        );
      setMessage(`${format.toUpperCase()} 已匯出。`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "匯出失敗");
    } finally {
      setBusy(false);
    }
  }
  const mileageRange = useMemo(
    () =>
      route && mileageReference
        ? mileageSpan(route.points, mileageReference)
        : null,
    [route, mileageReference],
  );
  const meters = route ? distance(route.points) : 0;
  const stations = useMemo(
    () =>
      route && mileageReference
        ? referenceWaypoints(route, mileageReference)
        : [],
    [route, mileageReference],
  );
  if (!route || !mileageReference)
    return (
      <main className="loading">
        <Route size={38} />
        <h1>620 路線工作室</h1>
        <p>{error || "載入預設雙路線…"}</p>
        {error && <button onClick={() => location.reload()}>重新載入</button>}
      </main>
    );
  return (
    <main className="studio">
      <header className="topbar">
        <div className="brand">
          <span className="brand-icon">
            <Route size={24} />
          </span>
          <span>
            <strong>
              620<span className="brand-light"> 路線工作室</span>
            </strong>
            <small>TWB 2026 · ROUTE STUDIO</small>
          </span>
        </div>
        <div className="top-status">
          <Cloud size={15} />
          <span>全站共用路線</span>
        </div>
        <div className="top-actions">
          <button
            onClick={() => file.current?.click()}
            disabled={busy || !canEdit}
            title={
              canEdit
                ? "匯入後會自動保存並公開顯示"
                : "請使用私人編輯連結啟用匯入"
            }
          >
            <Upload size={16} />
            <span>匯入軌跡</span>
          </button>
          <button onClick={() => setPanel("export")}>
            <Download size={16} />
            <span>匯出 Garmin</span>
          </button>
          <button
            className="primary"
            onClick={() => setPanel("save")}
            disabled={busy || !canEdit || syncState === "conflict"}
          >
            <Save size={16} />
            <span>儲存版本</span>
          </button>
          <button
            className="icon-button"
            aria-label="地圖設定"
            onClick={() => setPanel("settings")}
          >
            <Settings size={19} />
          </button>
        </div>
        <input
          hidden
          ref={file}
          type="file"
          accept=".gpx,.tcx,.fit,.json"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importSelected(f);
          }}
        />
      </header>
      <div
        className="sync-strip"
        data-state={syncState}
        role="status"
        aria-live="polite"
      >
        <Cloud size={14} />
        <span>
          {syncState === "loading"
            ? "正在載入共用路線…"
            : syncState === "saving"
              ? "正在自動儲存…"
              : syncState === "dirty"
                ? "有修改，等待自動儲存"
                : syncState === "error" || syncState === "conflict"
                  ? syncError
                  : updated
                    ? `已${canEdit ? "自動保存" : "載入共用路線"} · ${clock(updated)}`
                    : "內建雙路線"}
        </span>
        {syncState === "error" && canEdit && (
          <button onClick={() => void persist()}>重試儲存</button>
        )}
        {(syncState === "conflict" || syncState === "error") && (
          <button
            onClick={() => {
              if (
                dirty &&
                !window.confirm(
                  "請先匯出 JSON 備份；重新載入會捨棄此頁尚未保存的修改。確定載入最新共用路線？",
                )
              )
                return;
              location.reload();
            }}
          >
            重新載入
          </button>
        )}
        <small>
          {publicEdit
            ? "所有人可編輯 · 匯入資料會公開"
            : canEdit
              ? "編輯模式 · 所有人可瀏覽"
              : "瀏覽模式"}
        </small>
        {canEdit && !publicEdit && (
          <button
            onClick={async () => {
              try {
                const link = await cloud.current.editingLink();
                setEditingLink(link);
                setPanel("editing-link");
              } catch (e) {
                setError(e instanceof Error ? e.message : "無法複製編輯連結。");
              }
            }}
          >
            複製編輯連結
          </button>
        )}
      </div>
      <section className="workspace">
        <aside className="sidebar">
          <div className="route-title">
            <span className="eyebrow">2026.11.06 — 11.08</span>
            <div className="title-row">
              <h1>四極點 620</h1>
              <span className="tag">暫定路線</span>
            </div>
            <p>福隆出發，沿西海岸一路向南。</p>
            <div className="journey">
              <span>
                <i />
                福隆
              </span>
              <div />
              <span>
                鵝鑾鼻
                <Flag size={13} />
              </span>
            </div>
            <p className="hint">
              四極點620 里程：
              {mileageRange
                ? (mileageRange.start / 1000).toFixed(1) +
                  "–" +
                  (mileageRange.end / 1000).toFixed(1) +
                  " km"
                : "沒有可對齊路段"}
            </p>
            <div className="route-metrics">
              <div>
                <b>
                  {(meters / 1000).toFixed(1)}
                  <small> km</small>
                </b>
                <span>目前軌跡長度</span>
              </div>
              <div>
                <b>
                  {route.waypoints.length}
                  <small> 個</small>
                </b>
                <span>沿途點位</span>
              </div>
            </div>
            <button
              className="source-button"
              onClick={() => setPanel("source")}
            >
              <Info size={14} />
              <span>官方資料與里程差異</span>
              <ChevronRight size={15} />
            </button>
          </div>
          <div className="tabs">
            <button
              className={tab === "points" ? "active" : ""}
              onClick={() => setTab("points")}
            >
              <MapPin size={15} />
              沿途點位 <span>{route.waypoints.length}</span>
            </button>
            <button
              className={tab === "versions" ? "active" : ""}
              onClick={() => {
                setTab("versions");
                void loadVersions();
              }}
            >
              <History size={15} />
              版本紀錄
            </button>
          </div>
          <div className="sidebar-scroll">
            {tab === "points" ? (
              <>
                <div className="list-heading">
                  <span>依軌跡里程由近到遠</span>
                  <button
                    className="text-button"
                    disabled={!canEdit}
                    onClick={() => {
                      setMode("waypoint");
                      setPanel(null);
                    }}
                  >
                    <Plus size={14} />
                    新增
                  </button>
                </div>
                <div className="stations">
                  {stations.map(
                    ({ waypoint: w, meters: waypointMeters, offset }) => {
                      return (
                        <button
                          className="station-row"
                          key={w.id}
                          onClick={() => select(w)}
                        >
                          <span
                            className={
                              "station-number " +
                              (w.kind !== "checkpoint" ? "warm" : "")
                            }
                          >
                            {w.id === "start" ? (
                              <Flag size={14} />
                            ) : w.id === "finish" ? (
                              <Check size={15} />
                            ) : w.id.startsWith("cp") ? (
                              w.id.slice(2)
                            ) : (
                              <MapPin size={14} />
                            )}
                          </span>
                          <span className="station-content">
                            <strong>{w.name}</strong>
                            <span>
                              {waypointMeters === null
                                ? "無法定位基準里程"
                                : `四極點620 ${(waypointMeters / 1000).toFixed(1)} km`}
                              {offset !== null && offset > 1000
                                ? ` · 距基準 ${(offset / 1000).toFixed(1)} km`
                                : ""}
                              {w.cutoff
                                ? " · " + clock(w.cutoff)
                                : " · " + kinds[w.kind]}
                            </span>
                            <small>{w.accuracy ?? w.note ?? "自訂點位"}</small>
                          </span>
                          <ChevronRight size={14} />
                        </button>
                      );
                    },
                  )}
                </div>
                <p className="sidebar-note">
                  點選站點查看位置與關門時間。檢錄感應門位置以大會最終公告為準。
                </p>
              </>
            ) : (
              <div className="versions">
                <p className="hint">
                  最新內容會自動保存；版本是額外保留的歷史快照。匯入及回復也會建立快照。
                </p>
                <label className="history-switch">
                  版本來源
                  <select
                    value={legacy ? "legacy" : "shared"}
                    onChange={(e) => {
                      setLegacy(e.target.value === "legacy");
                      setVersionError("");
                      setVersions([]);
                    }}
                  >
                    <option value="shared">全站共用版本</option>
                    <option value="legacy">此瀏覽器的舊版私人版本</option>
                  </select>
                </label>
                {versionError ? (
                  <div className="inline-error">
                    <p>{versionError}</p>
                    <button onClick={() => void loadVersions()}>
                      重試讀取
                    </button>
                  </div>
                ) : !versions.length ? (
                  <div className="empty">
                    <History size={28} />
                    <h3>保留每一次路線調整</h3>
                    <p>
                      {legacy
                        ? "此瀏覽器沒有舊版私人版本。"
                        : "匯入路線或按「儲存版本」，即可在這裡回復與比較。"}
                    </p>
                    <button
                      onClick={() => setPanel("save")}
                      disabled={!canEdit}
                    >
                      儲存第一個版本
                    </button>
                  </div>
                ) : (
                  versions.map((v) => (
                    <article className="version" key={v.id}>
                      <span className="eyebrow">{clock(v.created)}</span>
                      <strong>{v.name}</strong>
                      <p>{v.note || "未填寫備註"}</p>
                      <span>
                        長度 {(v.distance / 1000).toFixed(1)} km ·{" "}
                        {v.id.slice(0, 8)}
                      </span>
                      {v.parent && (
                        <small>來源版本 {v.parent.slice(0, 8)}</small>
                      )}
                      <div>
                        <button
                          onClick={() => void restore(v)}
                          disabled={
                            busy || !canEdit || syncState === "conflict"
                          }
                        >
                          {legacy ? "載入並共用" : "回復此版本"}
                        </button>
                        <button onClick={() => setCompare(v)}>比較里程</button>
                      </div>
                    </article>
                  ))
                )}
              </div>
            )}
          </div>
          <footer className="sidebar-footer">
            <span className="mini-route" />
            <span>TWB 官方路線資料</span>
            <a
              href={officialUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="開啟官方公告"
            >
              <ExternalLink size={14} />
            </a>
          </footer>
        </aside>
        <div className="canvas" data-mode={mode}>
          <RouteMap
            route={route}
            mileageReference={mileageReference}
            mode={mode}
            apiKey={apiKey}
            focus={focus}
            fitSignal={fit}
            onPoints={onPoints}
            onAdd={onAdd}
            onSelect={select}
            onMove={move}
            onError={setError}
            onViewport={setViewport}
          />
          <div className="map-toolbar">
            <div>
              {(
                [
                  { id: "browse", label: "瀏覽", icon: MousePointer2 },
                  { id: "edit", label: "編輯路線", icon: Route },
                  { id: "append", label: "延伸路線", icon: Plus },
                  { id: "waypoint", label: "加入點位", icon: MapPin },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  title={m.label}
                  aria-pressed={mode === m.id}
                  disabled={m.id !== "browse" && !canEdit}
                  className={mode === m.id ? "active" : ""}
                  onClick={() => setMode(m.id)}
                >
                  <m.icon size={17} />
                  <span>{m.label}</span>
                </button>
              ))}
            </div>
            <div className="tool-separator" />
            <button
              className="icon-button"
              aria-label="復原"
              disabled={!undoReady || !canEdit}
              onClick={undo}
            >
              <Undo2 size={17} />
            </button>
            <button
              className="icon-button"
              aria-label="重做"
              disabled={!redoReady || !canEdit}
              onClick={redo}
            >
              <Redo2 size={17} />
            </button>
          </div>
          <button
            className="fit-button"
            aria-label="顯示全線"
            title="顯示全線"
            onClick={() => setFit((f) => f + 1)}
          >
            <Maximize size={16} />
            <span>全線</span>
          </button>
          <div className="map-help">
            <span className="orange-dot" />
            {modeHelp[mode]}
          </div>
          <section
            className="route-legend"
            aria-label="路線圖例"
            data-expanded={panelExpanded.legend}
          >
            <button
              className="map-panel-toggle"
              aria-expanded={panelExpanded.legend}
              aria-controls="route-legend-content"
              aria-label={
                panelExpanded.legend ? "收合路線圖例" : "展開路線圖例"
              }
              onClick={() =>
                setPanelExpanded((p) => ({ ...p, legend: !p.legend }))
              }
            >
              <Route size={17} />
              <span>路線圖例 · {1 + (route.overlays?.length ?? 0)} 條</span>
              <span className="panel-toggle-action">
                {panelExpanded.legend ? "收合" : "展開"}
              </span>
              <ChevronRight size={17} />
            </button>
            <div id="route-legend-content" className="map-panel-content">
              <strong>路線圖例</strong>
              <div className="legend-row">
                <i style={{ borderColor: activeRouteColor }} />
                <span>
                  <b>{route.name}</b>
                  <small>
                    目前編輯 · 路線長度 {(meters / 1000).toFixed(1)} km
                  </small>
                </span>
              </div>
              {(route.overlays ?? []).map((layer, i) => (
                <div className="legend-row" key={layer.id}>
                  <i
                    className="reference-swatch"
                    style={{ borderColor: overlayColor(i) }}
                  />
                  <span>
                    <b>{layer.name}</b>
                    <small>
                      參考路線 · 路線長度{" "}
                      {(distance(layer.points) / 1000).toFixed(1)} km
                    </small>
                  </span>
                  <button
                    className="icon-button"
                    aria-label={`移除參考路線 ${layer.name}`}
                    title="移除參考路線（可復原）"
                    disabled={!canEdit}
                    onClick={() =>
                      edit({
                        ...route,
                        overlays: route.overlays?.filter(
                          (l) => l.id !== layer.id,
                        ),
                      })
                    }
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              <p>位置里程以四極點620起點為準；Garmin 匯出使用目前編輯路線</p>
              {!apiKey && <p>設定 Google Maps 金鑰即可切換底圖</p>}
            </div>
          </section>
          <div
            className="elevation-card"
            data-expanded={panelExpanded.elevation}
          >
            <button
              className="map-panel-toggle"
              aria-expanded={panelExpanded.elevation}
              aria-controls="elevation-content"
              aria-label={panelExpanded.elevation ? "收合高度圖" : "展開高度圖"}
              onClick={() =>
                setPanelExpanded((p) => ({ ...p, elevation: !p.elevation }))
              }
            >
              <Route size={17} />
              <span>高度圖</span>
              <span className="panel-toggle-action">
                {panelExpanded.elevation ? "收合" : "展開"}
              </span>
              <ChevronRight size={17} />
            </button>
            <div id="elevation-content" className="map-panel-content">
              <div className="elevation-heading">
                <button
                  className="text-button"
                  onClick={() => setPanel("simplify")}
                  disabled={busy || !canEdit}
                >
                  簡化軌跡
                </button>
                <span>
                  <Route size={14} />
                  全路線高程
                </span>
                <span>
                  {route.points.length.toLocaleString()} 軌跡點 ·{" "}
                  {groups(route.points).length} 段
                </span>
              </div>
              <ElevationProfile
                route={route}
                mileageReference={mileageReference}
                viewport={viewport}
              />
            </div>
          </div>
        </div>
      </section>
      {(message || error) && (
        <div
          className={"toast " + (error ? "error" : "")}
          role={error ? "alert" : "status"}
        >
          <span>{error || message}</span>
          <button
            aria-label="關閉通知"
            onClick={() => {
              setMessage("");
              setError("");
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {compare && (
        <div className="comparison">
          <button
            className="icon-button"
            aria-label="關閉比較"
            onClick={() => setCompare(null)}
          >
            <X size={16} />
          </button>
          <span>與 {clock(compare.created)} 版本比較長度</span>
          <strong>
            {meters >= compare.distance ? "+" : ""}
            {((meters - compare.distance) / 1000).toFixed(2)} km
          </strong>
          <small>
            目前 {(meters / 1000).toFixed(2)} km / 版本{" "}
            {(compare.distance / 1000).toFixed(2)} km
          </small>
        </div>
      )}
      <Dialogs
        key={apiKey}
        panel={panel}
        close={closePanel}
        route={route}
        mileageReference={mileageReference}
        edit={edit}
        mapsConfigStatus={mapsConfigStatus}
        managementToken={managementToken}
        selected={selected}
        setSelected={setSelected}
        save={save}
        exportAs={exportAs}
        busy={busy}
        canEdit={canEdit}
        editingLink={editingLink}
        storageName={storageName}
      />
    </main>
  );
}
