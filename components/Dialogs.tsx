"use client";
import { useEffect, useRef, useState } from "react";
import {
  Bike,
  Route,
  MapPin,
  Download,
  X,
  ExternalLink,
  Cloud,
  Copy,
  Trash2,
} from "lucide-react";
import {
  cumulative,
  distance,
  groups,
  nearest,
  officialUrl,
  stravaUrl,
  simplify,
  type RouteData,
  type Waypoint,
} from "../lib/route";
export type Panel =
  null | "settings" | "save" | "export" | "source" | "point" | "simplify";
type Props = {
  panel: Panel;
  close: () => void;
  route: RouteData;
  edit: (r: RouteData) => void;
  apiKey: string;
  setApiKey: (s: string) => void;
  selected: Waypoint | null;
  setSelected: (w: Waypoint) => void;
  save: (note: string) => Promise<void>;
  exportAs: (f: "fit" | "tcx" | "gpx" | "json") => Promise<void>;
  busy: boolean;
};
const clock = (s: string) =>
  new Date(s).toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
export default function Dialogs({
  panel,
  close,
  route,
  edit,
  apiKey,
  setApiKey,
  selected,
  setSelected,
  save,
  exportAs,
  busy,
}: Props) {
  const [keyInput, setKeyInput] = useState(apiKey),
    [note, setNote] = useState(""),
    [tolerance, setTolerance] = useState(4);
  const dialog = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!panel) return;
    const old = document.activeElement as HTMLElement;
    dialog.current?.querySelector<HTMLElement>("input,button")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "Tab") {
        const nodes = Array.from(
          dialog.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input,textarea,select,a[href]",
          ) ?? [],
        );
        if (e.shiftKey && document.activeElement === nodes[0]) {
          e.preventDefault();
          nodes.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
          e.preventDefault();
          nodes[0]?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      old?.focus();
    };
  }, [panel, close]);
  if (!panel) return null;
  const meters = distance(route.points),
    ds = cumulative(route.points);
  const kinds = {
    checkpoint: "檢錄點",
    water: "補水",
    food: "補給",
    rest: "休息",
    custom: "自訂",
  };
  return (
    <div className="modal-backdrop" onClick={close}>
      <section
        ref={dialog}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={
          {
            settings: "地圖設定",
            save: "儲存路線版本",
            export: "匯出 Garmin",
            source: "官方資料",
            point: "點位編輯",
            simplify: "簡化軌跡",
          }[panel]
        }
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-heading">
          <span className="eyebrow">620 ROUTE STUDIO</span>
          <button className="icon-button" aria-label="關閉視窗" onClick={close}>
            <X size={20} />
          </button>
        </div>
        {panel === "simplify" && (
          <>
            <h2>簡化軌跡</h2>
            <p>
              減少密集的 Garmin
              軌跡點，方便編輯及儲存版本。保留分段起終點與所有沿途點位，可用復原返回。
            </p>
            <label>
              水平容差（公尺）
              <input
                type="number"
                min={1}
                max={50}
                value={tolerance}
                onChange={(e) =>
                  setTolerance(
                    Math.max(1, Math.min(50, Number(e.target.value) || 1)),
                  )
                }
              />
            </label>
            <div className="save-summary">
              <Route size={17} />
              <span>
                {route.points.length.toLocaleString()} →{" "}
                {simplify(route.points, tolerance).length.toLocaleString()}{" "}
                個軌跡點
              </span>
            </div>
            <p className="hint">
              簡化可能略微改變里程與高度剖面。請保留原始紀錄。
            </p>
            <div className="modal-actions">
              <button onClick={close}>取消</button>
              <button
                className="primary"
                disabled={
                  busy ||
                  simplify(route.points, tolerance).length ===
                    route.points.length
                }
                onClick={() => {
                  edit({
                    ...route,
                    points: simplify(route.points, tolerance),
                    provenance: route.provenance + `；使用者簡化 ${tolerance}m`,
                  });
                  close();
                }}
              >
                套用簡化
              </button>
            </div>
          </>
        )}
        {panel === "settings" && (
          <>
            <h2>地圖設定</h2>
            <p>設定金鑰後，路線與點位會顯示在 Google Maps 互動底圖。</p>
            <label>
              Maps JavaScript API 金鑰
              <input
                type="password"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                autoComplete="off"
                placeholder="AIza…"
              />
            </label>
            <p className="hint">
              金鑰只保存在此瀏覽器，不會進入 GitHub 或路線版本。請啟用 Maps
              JavaScript API，並將網站限制設為{" "}
              <code>
                {typeof location !== "undefined" ? location.origin + "/*" : ""}
              </code>
              。
            </p>
            <a
              className="external-text"
              href="https://developers.google.com/maps/documentation/javascript/get-api-key"
              target="_blank"
              rel="noreferrer"
            >
              Google 官方設定說明 <ExternalLink size={14} />
            </a>
            <div className="modal-actions">
              <button
                onClick={() => {
                  localStorage.removeItem("620-google-key");
                  if (apiKey) location.reload();
                  else {
                    setKeyInput("");
                    close();
                  }
                }}
              >
                清除金鑰
              </button>
              <button
                className="primary"
                onClick={() => {
                  localStorage.setItem("620-google-key", keyInput.trim());
                  if (apiKey && keyInput.trim() !== apiKey) {
                    location.reload();
                    return;
                  }
                  setApiKey(keyInput.trim());
                  close();
                }}
              >
                套用設定
              </button>
            </div>
          </>
        )}
        {panel === "save" && (
          <>
            <h2>儲存路線版本</h2>
            <p>每次儲存都會新增版本，保留之前的路線與點位。</p>
            <label>
              路線名稱
              <input
                value={route.name}
                maxLength={120}
                onChange={(e) => edit({ ...route, name: e.target.value })}
              />
            </label>
            <label>
              這次調整了什麼？
              <textarea
                value={note}
                maxLength={2000}
                onChange={(e) => setNote(e.target.value)}
                placeholder="例如：調整香山補給，加入便利商店…"
                rows={3}
              />
            </label>
            <div className="save-summary">
              <Cloud size={17} />
              <span>
                {(meters / 1000).toFixed(2)} km · {route.waypoints.length}{" "}
                個點位 · 雲端保存
              </span>
            </div>
            <div className="modal-actions">
              <button onClick={close}>取消</button>
              <button
                className="primary"
                onClick={() => void save(note)}
                disabled={busy || !route.name.trim()}
              >
                {busy ? "儲存中…" : "儲存新版本"}
              </button>
            </div>
          </>
        )}
        {panel === "export" && (
          <>
            <h2>帶上路線，準備出發</h2>
            <p>
              下載編輯後的路線，匯入 Garmin Connect 再選「傳送至裝置」，同步到
              Edge。
            </p>
            <div className="export-options">
              <button
                onClick={() => void exportAs("fit")}
                disabled={busy || groups(route.points).length > 1}
              >
                <Bike size={22} />
                <span>
                  <strong>FIT 課程</strong>
                  <small>Garmin 原生格式，包含自訂課程點</small>
                </span>
                <Download size={17} />
              </button>
              <button onClick={() => void exportAs("tcx")} disabled={busy}>
                <Route size={22} />
                <span>
                  <strong>TCX 路線</strong>
                  <small>包含檢錄與補給點位</small>
                </span>
                <Download size={17} />
              </button>
              <button onClick={() => void exportAs("gpx")} disabled={busy}>
                <MapPin size={22} />
                <span>
                  <strong>GPX 軌跡</strong>
                  <small>通用軌跡格式，保留分段與獨立點位</small>
                </span>
                <Download size={17} />
              </button>
              <button onClick={() => void exportAs("json")} disabled={busy}>
                <Copy size={22} />
                <span>
                  <strong>完整編輯備份</strong>
                  <small>JSON，保留備註、來源與點位資料</small>
                </span>
                <Download size={17} />
              </button>
            </div>
            <p className="hint">
              FIT／TCX 的課程時間以 25km/h
              產生，非實際騎乘紀錄。匯出不產生自動轉彎指示；Connect
              可能重算或省略課程點，請在 Edge 上檢查。分段軌跡請用 GPX。支援 USB
              檔案傳輸的 Edge 也可將 FIT 複製至 Garmin/NewFiles 後重新啟動。
            </p>
            <a
              className="external-text"
              href="https://connect.garmin.com/modern/courses"
              target="_blank"
              rel="noreferrer"
            >
              開啟 Garmin Connect <ExternalLink size={14} />
            </a>
          </>
        )}
        {panel === "source" && (
          <>
            <h2>官方資料與路線來源</h2>
            <p>
              資料查核：2026/10/08。TWB 活動為 2026/11/06 18:00 至 11/08
              04:00（台灣時間），限時 34 小時。
            </p>
            <div className="source-metrics">
              <div>
                <b>620 km</b>
                <small>活動名稱／約略全程</small>
              </div>
              <div>
                <b>615 km</b>
                <small>官方站點表終點里程</small>
              </div>
              <div>
                <b>{(meters / 1000).toFixed(1)} km</b>
                <small>目前編輯軌跡的計算長度</small>
              </div>
            </div>
            <p>
              基準軌跡取自 TWB 官方頁面嵌入的 Strava 路線（2026/09/29
              建立），原始 33,146 點，編輯版採 4m
              幾何簡化。官方文字目前經關渡大橋，仍標示為暫定路線；文字、站點表與嵌入軌跡有差異，以最終公告為準。
            </p>
            <p>
              站點名稱、公告里程與關門時間來自官方站點表；多數座標依地標估位，感應門尚待確認，可在點位詳情調整。
            </p>
            <div className="source-links">
              <a href={officialUrl} target="_blank" rel="noreferrer">
                TWB 官方公告 <ExternalLink size={14} />
              </a>
              <a href={stravaUrl} target="_blank" rel="noreferrer">
                官方嵌入 Strava 路線 <ExternalLink size={14} />
              </a>
              <a href="/data/twb-2026-original.gpx" download>
                下載未簡化基準 GPX <Download size={14} />
              </a>
            </div>
            <p className="hint">目前來源：{route.provenance}</p>
          </>
        )}
        {panel === "point" && selected && (
          <>
            <h2>
              {route.waypoints.some((w) => w.id === selected.id)
                ? "點位詳情"
                : "加入沿途點位"}
            </h2>
            <label>
              點位名稱
              <input
                value={selected.name}
                maxLength={120}
                onChange={(e) =>
                  setSelected({ ...selected, name: e.target.value })
                }
              />
            </label>
            <label>
              類型
              <select
                value={selected.kind}
                onChange={(e) =>
                  setSelected({
                    ...selected,
                    kind: e.target.value as Waypoint["kind"],
                  })
                }
              >
                {Object.entries(kinds).map(([k, v]) => (
                  <option value={k} key={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <div className="coordinate-fields">
              <label>
                緯度
                <input
                  type="number"
                  step="0.000001"
                  value={selected.lat}
                  onChange={(e) =>
                    setSelected({ ...selected, lat: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                經度
                <input
                  type="number"
                  step="0.000001"
                  value={selected.lng}
                  onChange={(e) =>
                    setSelected({ ...selected, lng: Number(e.target.value) })
                  }
                />
              </label>
            </div>
            <label>
              備註
              <textarea
                rows={3}
                maxLength={3000}
                value={selected.note}
                onChange={(e) =>
                  setSelected({ ...selected, note: e.target.value })
                }
              />
            </label>
            {selected.officialKm !== undefined && (
              <div className="point-info">
                <span>
                  官方公告里程 <b>{selected.officialKm} km</b>
                </span>
                <span>
                  目前路線最近位置{" "}
                  <b>
                    {(ds[nearest(route.points, selected).idx] / 1000).toFixed(
                      1,
                    )}{" "}
                    km
                  </b>
                </span>
                <span>
                  距離軌跡{" "}
                  <b>{Math.round(nearest(route.points, selected).meters)} m</b>
                </span>
                {selected.cutoff && (
                  <span>
                    關門時間（台灣）<b>{clock(selected.cutoff)}</b>
                  </span>
                )}
              </div>
            )}
            {selected.accuracy && (
              <p className="hint">位置依據：{selected.accuracy}</p>
            )}
            <a
              className="external-text"
              href={
                "https://www.google.com/maps/search/?api=1&query=" +
                encodeURIComponent(selected.lat + "," + selected.lng)
              }
              target="_blank"
              rel="noreferrer"
            >
              在 Google Maps 查看 <ExternalLink size={14} />
            </a>
            <div className="modal-actions">
              <button
                className="danger"
                disabled={!route.waypoints.some((w) => w.id === selected.id)}
                onClick={() => {
                  edit({
                    ...route,
                    waypoints: route.waypoints.filter(
                      (w) => w.id !== selected.id,
                    ),
                  });
                  close();
                }}
              >
                <Trash2 size={15} />
                移除點位
              </button>
              <button
                className="primary"
                disabled={
                  !selected.name.trim() ||
                  !Number.isFinite(selected.lat) ||
                  !Number.isFinite(selected.lng) ||
                  Math.abs(selected.lat) > 90 ||
                  Math.abs(selected.lng) > 180
                }
                onClick={() => {
                  const exists = route.waypoints.some(
                      (w) => w.id === selected.id,
                    ),
                    old = route.waypoints.find((w) => w.id === selected.id);
                  const w = {
                    ...selected,
                    ...(old &&
                    (old.lat !== selected.lat || old.lng !== selected.lng)
                      ? { accuracy: "使用者調整位置" }
                      : {}),
                  };
                  edit({
                    ...route,
                    waypoints: exists
                      ? route.waypoints.map((v) => (v.id === w.id ? w : v))
                      : [...route.waypoints, w],
                  });
                  close();
                }}
              >
                儲存點位
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
