"use client";
import { useCallback, useEffect, useRef, useState } from "react";
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
import Dialogs, { type Panel } from "./Dialogs";
import {
  checkpointSeed,
  cumulative,
  distance,
  groups,
  nearest,
  officialUrl,
  validateRoute,
  type RouteData,
  type Waypoint,
  type TrackPoint,
} from "../lib/route";
import {
  download,
  exportFit,
  exportGpx,
  exportTcx,
  importFile,
} from "../lib/files";
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
export default function Editor() {
  const [route, setRoute] = useState<RouteData | null>(null),
    [mode, setMode] = useState<Mode>("browse"),
    [tab, setTab] = useState<"points" | "versions">("points"),
    [panel, setPanel] = useState<Panel>(null),
    [selected, setSelected] = useState<Waypoint | null>(null),
    [focus, setFocus] = useState<Waypoint | null>(null),
    [fit, setFit] = useState(0),
    [apiKey, setApiKey] = useState(""),
    [versions, setVersions] = useState<Version[]>([]),
    [versionError, setVersionError] = useState(""),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [savedId, setSavedId] = useState<string | undefined>(),
    [undoReady, setUndoReady] = useState(false),
    [redoReady, setRedoReady] = useState(false),
    [compare, setCompare] = useState<Version | null>(null);
  const file = useRef<HTMLInputElement>(null),
    past = useRef<RouteData[]>([]),
    future = useRef<RouteData[]>([]),
    current = useRef<RouteData | null>(null);
  useEffect(() => {
    current.current = route;
  }, [route]);
  const closePanel = useCallback(() => setPanel(null), []);
  const edit = (next: RouteData) => {
    if (current.current) {
      past.current.push(clone(current.current));
      if (past.current.length > 35) past.current.shift();
    }
    future.current = [];
    setRoute(next);
    setDirty(true);
    setUndoReady(past.current.length > 0);
    setRedoReady(future.current.length > 0);
  };
  async function loadVersions() {
    try {
      const r = await fetch("/api/versions", { cache: "no-store" }),
        d = (await r.json()) as { error?: string; versions: Version[] };
      if (!r.ok) throw Error(d.error);
      setVersions(d.versions);
      setVersionError("");
    } catch (e) {
      setVersionError(e instanceof Error ? e.message : "版本讀取失敗");
    }
  }
  useEffect(() => {
    let active = true;
    fetch("/data/twb-2026.json")
      .then((r) => {
        if (!r.ok) throw Error("官方基準軌跡載入失敗");
        return r.json();
      })
      .then((d) => {
        if (active)
          setRoute({ ...validateRoute(d), waypoints: clone(checkpointSeed) });
      })
      .catch((e) => setError(e.message));
    void Promise.resolve().then(() =>
      setApiKey(localStorage.getItem("620-google-key") ?? ""),
    );
    void Promise.resolve().then(loadVersions);
    return () => {
      active = false;
    };
  }, []);
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
    if (!past.current.length || !current.current) return;
    future.current.push(clone(current.current));
    setRoute(past.current.pop()!);
    setDirty(true);
    setUndoReady(past.current.length > 0);
    setRedoReady(future.current.length > 0);
  }
  function redo() {
    if (!future.current.length || !current.current) return;
    past.current.push(clone(current.current));
    setRoute(future.current.pop()!);
    setDirty(true);
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
    setBusy(true);
    setError("");
    try {
      const next = await importFile(f);
      if (
        dirty &&
        !window.confirm("目前編輯尚未儲存。要匯入檔案取代路線？可用復原返回。")
      )
        return;
      edit(next);
      setSavedId(undefined);
      setFit((v) => v + 1);
      setMessage(
        `已匯入 ${f.name}：${next.points.length.toLocaleString()} 個軌跡點。`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "匯入失敗");
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  }
  async function save(note: string) {
    if (!route || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/versions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            route: { ...route, parentId: savedId },
            note,
          }),
        }),
        d = (await r.json()) as { error?: string; id: string };
      if (!r.ok) throw Error(d.error);
      setSavedId(d.id);
      setDirty(current.current !== route);
      setPanel(null);
      setMessage("版本已儲存到雲端。");
      await loadVersions();
    } catch (e) {
      setError(e instanceof Error ? e.message : "儲存失敗");
    } finally {
      setBusy(false);
    }
  }
  async function restore(v: Version) {
    if (
      dirty &&
      !window.confirm("目前有未儲存的修改。要載入此版本？可用復原返回。")
    )
      return;
    setBusy(true);
    try {
      const r = await fetch("/api/versions?id=" + encodeURIComponent(v.id)),
        d = (await r.json()) as { error?: string; route: RouteData };
      if (!r.ok) throw Error(d.error);
      edit(validateRoute(d.route));
      setSavedId(v.id);
      setDirty(false);
      setFit((x) => x + 1);
      setMessage("已載入版本；後續儲存會建立新版本。");
    } catch (e) {
      setError(e instanceof Error ? e.message : "載入失敗");
    } finally {
      setBusy(false);
    }
  }
  async function exportAs(format: "fit" | "tcx" | "gpx" | "json") {
    if (!route) return;
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
  const meters = route ? distance(route.points) : 0,
    ds = route ? cumulative(route.points) : [];
  const elevation = route?.points.filter((p) => p.ele !== undefined) ?? [],
    maxEle = Math.max(50, ...elevation.map((p) => p.ele!)),
    minEle = Math.min(0, ...elevation.map((p) => p.ele!));
  const elevationPath =
    route?.points
      .map((p, i) => ({ p, i }))
      .filter(
        ({ p, i }) =>
          p.ele !== undefined &&
          i % Math.max(1, Math.ceil(route.points.length / 700)) === 0,
      )
      .map(
        ({ p, i }) =>
          `${(ds[i] / (meters || 1)) * 1000},${82 - ((p.ele! - minEle) / (maxEle - minEle)) * 65}`,
      )
      .join(" ") ?? "";
  if (!route)
    return (
      <main className="loading">
        <Route size={38} />
        <h1>620 路線工作室</h1>
        <p>{error || "載入官方路線…"}</p>
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
          <span>
            {dirty
              ? "有未儲存的修改"
              : savedId
                ? "已載入雲端版本"
                : "官方基準路線"}
          </span>
        </div>
        <div className="top-actions">
          <button onClick={() => file.current?.click()} disabled={busy}>
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
            disabled={busy}
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
                  <span>起終點 / 檢錄 / 自訂</span>
                  <button
                    className="text-button"
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
                  {route.waypoints.map((w) => {
                    const n = nearest(route.points, w);
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
                            {w.officialKm !== undefined
                              ? `公告 ${w.officialKm} km`
                              : `軌跡 ${(ds[n.idx] / 1000).toFixed(1)} km`}
                            {w.cutoff
                              ? " · " + clock(w.cutoff)
                              : " · " + kinds[w.kind]}
                          </span>
                          <small>{w.accuracy ?? w.note ?? "自訂點位"}</small>
                        </span>
                        <ChevronRight size={14} />
                      </button>
                    );
                  })}
                </div>
                <p className="sidebar-note">
                  點選站點查看位置與關門時間。檢錄感應門位置以大會最終公告為準。
                </p>
              </>
            ) : (
              <div className="versions">
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
                    <p>儲存第一個版本後，可在這裡載入、比較里程與建立分支。</p>
                    <button onClick={() => setPanel("save")}>
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
                        {(v.distance / 1000).toFixed(1)} km · {v.id.slice(0, 8)}
                      </span>
                      {v.parent && (
                        <small>來源版本 {v.parent.slice(0, 8)}</small>
                      )}
                      <div>
                        <button onClick={() => void restore(v)} disabled={busy}>
                          載入版本
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
            <span>官方嵌入 Strava 軌跡</span>
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
        <div className="canvas">
          <RouteMap
            route={route}
            mode={mode}
            apiKey={apiKey}
            focus={focus}
            fitSignal={fit}
            onPoints={onPoints}
            onAdd={onAdd}
            onSelect={select}
            onMove={move}
            onError={setError}
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
              disabled={!undoReady}
              onClick={undo}
            >
              <Undo2 size={17} />
            </button>
            <button
              className="icon-button"
              aria-label="重做"
              disabled={!redoReady}
              onClick={redo}
            >
              <Redo2 size={17} />
            </button>
          </div>
          <button className="fit-button" onClick={() => setFit((f) => f + 1)}>
            <Maximize size={16} />
            <span>全線</span>
          </button>
          <div className="map-help">
            <span className="orange-dot" />
            {modeHelp[mode]}
          </div>
          <div className="elevation-card">
            <div className="elevation-heading">
              <button
                className="text-button"
                onClick={() => setPanel("simplify")}
                disabled={busy}
              >
                簡化軌跡
              </button>
              <span>
                <Route size={14} />
                路線概覽
              </span>
              <span>
                {route.points.length.toLocaleString()} 軌跡點 ·{" "}
                {groups(route.points).length} 段
              </span>
            </div>
            {elevation.length > 1 ? (
              <svg
                className="elevation"
                viewBox="0 0 1000 90"
                preserveAspectRatio="none"
                role="img"
                aria-label="軌跡高度剖面"
              >
                <path
                  d={"M " + elevationPath.replace(/ /g, " L ")}
                  fill="none"
                  stroke="#ef5b35"
                  strokeWidth="1.7"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            ) : (
              <div className="elevation-empty">此軌跡無高度資料</div>
            )}
            <div className="elevation-axis">
              <span>0 km</span>
              <span>{(meters / 2000).toFixed(0)} km</span>
              <span>{(meters / 1000).toFixed(1)} km</span>
            </div>
            <div className="elevation-caption">
              高度{" "}
              {elevation.length
                ? `${Math.round(minEle)}–${Math.round(maxEle)} m`
                : "無資料"}{" "}
              · 里程依座標計算；編輯路段不自動貼齊道路
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
          <span>與 {clock(compare.created)} 版本比較</span>
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
        edit={edit}
        apiKey={apiKey}
        setApiKey={setApiKey}
        selected={selected}
        setSelected={setSelected}
        save={save}
        exportAs={exportAs}
        busy={busy}
      />
    </main>
  );
}
