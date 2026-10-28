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
  distance,
  groups,
  nearest,
  officialUrl,
  stravaUrl,
  simplify,
  type RouteData,
  type Waypoint,
} from "../lib/route";
import { projector, type MileageReference } from "../lib/mileage";
export type Panel =
  | null
  | "settings"
  | "save"
  | "export"
  | "source"
  | "point"
  | "simplify"
  | "editing-link";
type Props = {
  panel: Panel;
  close: () => void;
  route: RouteData;
  mileageReference: MileageReference;
  edit: (r: RouteData) => void;
  managementToken: string;
  mapsConfigStatus: "loading" | "server" | "legacy" | "missing" | "error";
  selected: Waypoint | null;
  setSelected: (w: Waypoint) => void;
  save: (note: string) => Promise<void>;
  exportAs: (f: "fit" | "tcx" | "gpx" | "json") => Promise<void>;
  busy: boolean;
  canEdit: boolean;
  editingLink: string;
  storageName: string;
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
  mileageReference,
  edit,
  mapsConfigStatus,
  managementToken,
  selected,
  setSelected,
  save,
  exportAs,
  busy,
  canEdit,
  editingLink,
  storageName,
}: Props) {
  const [keyInput, setKeyInput] = useState(""),
    [keySaving, setKeySaving] = useState(false),
    [keyResult, setKeyResult] = useState(""),
    [keySaved, setKeySaved] = useState(false),
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
  const meters = distance(route.points);
  const selectedProjection = selected
    ? projector(mileageReference.points, Infinity)(selected)
    : null;
  const selectedMileage = selectedProjection?.meters ?? null;
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
            "editing-link": "私人編輯連結",
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
        {panel === "editing-link" && canEdit && (
          <>
            <h2>私人編輯連結</h2>
            <p>
              在自己的其他裝置開啟即可編輯。原網址供所有人瀏覽；此連結含編輯權限，請勿公開分享。
            </p>
            <label>
              長按或選取後複製
              <textarea
                readOnly
                rows={4}
                value={editingLink}
                onFocus={(e) => e.target.select()}
              />
            </label>
            <div className="modal-actions">
              <button onClick={close}>關閉</button>
              <button
                className="primary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(editingLink);
                    setKeyResult("已複製編輯連結。");
                  } catch {
                    setKeyResult("請選取上方連結，使用系統的複製功能。");
                  }
                }}
              >
                <Copy size={16} />
                複製連結
              </button>
            </div>
            <p role="status">{keyResult}</p>
          </>
        )}
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
                  !canEdit ||
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
            <p role="status">
              {mapsConfigStatus === "server"
                ? "已使用後端共用金鑰，所有裝置套用相同設定。"
                : mapsConfigStatus === "legacy"
                  ? "目前暫用此瀏覽器原有金鑰；尚未讀到後端共用金鑰。"
                  : mapsConfigStatus === "loading"
                    ? "正在讀取後端地圖設定…"
                    : mapsConfigStatus === "error"
                      ? "後端設定暫時無法讀取，請稍後重新檢查。"
                      : "後端尚未設定金鑰，目前使用 OpenStreetMap 備用底圖。"}
            </p>
            {managementToken ? (
              <>
                <p className="hint">
                  這是你的私密管理設定頁。金鑰會存入後端資料庫，所有裝置共用；管理連結只在有限時間內有效，請勿分享。
                </p>
                <label>
                  Maps JavaScript API 金鑰
                  <input
                    type="password"
                    value={keyInput}
                    autoComplete="off"
                    placeholder="AIza…"
                    onChange={(event) => {
                      setKeyInput(event.target.value);
                      setKeySaved(false);
                      setKeyResult("");
                    }}
                  />
                </label>
                <button
                  className="primary"
                  disabled={keySaving || !keyInput.trim()}
                  onClick={async () => {
                    setKeySaving(true);
                    setKeyResult("");
                    try {
                      const response = await fetch("/api/maps-config", {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                          Authorization: "Bearer " + managementToken,
                        },
                        body: JSON.stringify({ apiKey: keyInput.trim() }),
                      });
                      const result = (await response.json()) as {
                        error?: string;
                      };
                      if (!response.ok)
                        throw Error(result.error || "金鑰儲存失敗");
                      try {
                        localStorage.removeItem("620-google-key");
                      } catch {
                        /* Storage may be disabled. */
                      }
                      setKeyInput("");
                      setKeySaved(true);
                      setKeyResult(
                        "金鑰已存入後端。請先儲存路線，再按『重新檢查後端設定』載入地圖。",
                      );
                    } catch (error) {
                      setKeyResult(
                        error instanceof Error ? error.message : "金鑰儲存失敗",
                      );
                    } finally {
                      setKeySaving(false);
                    }
                  }}
                >
                  {keySaving ? "儲存中…" : "儲存金鑰到後端"}
                </button>
                {keyResult && (
                  <p role={keySaved ? "status" : "alert"}>{keyResult}</p>
                )}
              </>
            ) : (
              <p className="hint">
                共用金鑰由網站擁有者透過私密管理設定頁修改，公開訪客無法覆寫。也可由主機管理者設定秘密環境變數
                GOOGLE_MAPS_API_KEY 作為備用。
              </p>
            )}
            <p className="hint">
              Google Maps 載入時仍會把瀏覽器金鑰傳給瀏覽器。請限制 API 為 Maps
              JavaScript API，網站限制設為{" "}
              <code>
                {typeof location !== "undefined" ? location.origin + "/*" : ""}
              </code>
              。 地圖右上角「全線」下方可切換地圖、衛星與地形。
            </p>
            <a
              className="external-text"
              href="https://developers.google.com/maps/api-security-best-practices"
              target="_blank"
              rel="noreferrer"
            >
              Google 官方金鑰設定說明 <ExternalLink size={14} />
            </a>
            {mapsConfigStatus === "legacy" && (
              <p className="hint">
                原有瀏覽器金鑰僅作移轉期間備用，不會自動上傳。完成後端設定後會優先使用共用金鑰。
              </p>
            )}
            <p className="hint">重新載入前，請先儲存未保存的路線編輯。</p>
            <div className="modal-actions">
              <button onClick={close}>關閉</button>
              <button className="primary" onClick={() => location.reload()}>
                重新檢查後端設定
              </button>
            </div>
          </>
        )}
        {panel === "save" && (
          <>
            <h2>儲存路線版本</h2>
            <p>
              最新路線會自動保存，任何裝置開啟原網址都能看到。這裡另存一份歷史快照，供日後回復與比較；所有共用版本皆公開可見。
            </p>
            <label>
              路線名稱
              <input
                value={route.name}
                readOnly={!canEdit}
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
                路線長度 {(meters / 1000).toFixed(2)} km ·{" "}
                {route.waypoints.length} 個點位 · {storageName}保存
              </span>
            </div>
            <div className="modal-actions">
              <button onClick={close}>取消</button>
              <button
                className="primary"
                onClick={() => void save(note)}
                disabled={busy || !canEdit || !route.name.trim()}
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
              Edge。FIT／TCX／GPX 匯出目前編輯的橘色路線；JSON
              備份另包含全部參考圖層。
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
                readOnly={!canEdit}
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
                disabled={!canEdit}
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
                  readOnly={!canEdit}
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
                  readOnly={!canEdit}
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
                readOnly={!canEdit}
                onChange={(e) =>
                  setSelected({ ...selected, note: e.target.value })
                }
              />
            </label>
            <div className="point-info">
              <span>
                四極點620 起點里程{" "}
                <b>
                  {selectedMileage === null
                    ? "無法定位基準里程"
                    : (selectedMileage / 1000).toFixed(1) + " km"}
                </b>
              </span>
              <span>
                距離四極點620基準軌跡{" "}
                <b>
                  {selectedProjection
                    ? Math.round(selectedProjection.error) + " m"
                    : "—"}
                </b>
              </span>
              <span>
                距離目前編輯軌跡{" "}
                <b>{Math.round(nearest(route.points, selected).meters)} m</b>
              </span>
              {selected.cutoff && (
                <span>
                  關門時間（台灣）<b>{clock(selected.cutoff)}</b>
                </span>
              )}
            </div>
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
                disabled={
                  !canEdit || !route.waypoints.some((w) => w.id === selected.id)
                }
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
                  !canEdit ||
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
