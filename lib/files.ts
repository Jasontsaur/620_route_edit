import {
  cumulative,
  distance,
  groups,
  nearest,
  type RouteData,
  type TrackPoint,
  type Waypoint,
} from "./route";
import { compactImportedRoute, type ImportProgress } from "./compact-import";
import { readXmlTrack } from "./xml-track";
import {
  deriveRecordingMetrics,
  fitEpochMs,
  type RecordingSample,
} from "./record-metrics";
const xml = (s: unknown) =>
  String(s ?? "").replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
export async function importFile(
  file: File,
  progress?: (p: ImportProgress) => void,
): Promise<RouteData> {
  if (file.size > 100000000)
    throw Error("檔案超過 100MB，請分段匯入，避免耗盡手機記憶體。");
  progress?.({ message: "正在讀取檔案…" });
  const ext = file.name.split(".").at(-1)?.toLowerCase();
  let points: TrackPoint[] = [],
    waypoints: Waypoint[] = [];
  let name = file.name.replace(/\.[^.]+$/, "");
  if (ext === "json") {
    return compactImportedRoute(JSON.parse(await file.text()), progress);
  }
  if (ext === "fit") {
    const { Decoder, Stream } = await import("@garmin/fitsdk");
    const decoder = new Decoder(
      Stream.fromArrayBuffer(await file.arrayBuffer()),
    );
    if (!decoder.isFIT() || !decoder.checkIntegrity())
      throw Error("FIT 檔案損毀或 CRC 檢查未通過。");
    progress?.({ message: "正在解析 Garmin 紀錄…" });
    const { messages, errors } = decoder.read({
      mergeHeartRates: false,
      convertDateTimesToDates: false,
    });
    if (errors.length) throw Error("FIT 解碼失敗。");
    const rec = messages.recordMesgs ?? [];
    let segment = 0,
      gap = false,
      sawValid = false;
    const activity = messages.fileIdMesgs?.[0]?.type === "activity";
    const events = (messages.eventMesgs ?? [])
      .filter((e) => e.event === "timer" && typeof e.timestamp === "number")
      .sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
    let eventIndex = 0,
      timerRunning = true;
    const raw: RecordingSample[] = rec.map((r) => {
      while (
        eventIndex < events.length &&
        Number(events[eventIndex].timestamp) <= Number(r.timestamp)
      ) {
        const event = events[eventIndex++];
        if (event.eventType === "start") timerRunning = true;
        else if (String(event.eventType).startsWith("stop"))
          timerRunning = false;
      }
      const speed = Number.isFinite(r.enhancedSpeed)
        ? r.enhancedSpeed
        : r.speed;
      return {
        lat:
          typeof r.positionLat === "number"
            ? (r.positionLat * 180) / 2 ** 31
            : NaN,
        lng:
          typeof r.positionLong === "number"
            ? (r.positionLong * 180) / 2 ** 31
            : NaN,
        ...(Number.isFinite(r.enhancedAltitude ?? r.altitude)
          ? { ele: Number(r.enhancedAltitude ?? r.altitude) }
          : {}),
        ...(activity
          ? {
              ...(typeof r.timestamp === "number"
                ? { timestampMs: fitEpochMs + r.timestamp * 1000 }
                : {}),
              ...(typeof speed === "number" ? { speedMps: speed } : {}),
              ...(typeof r.power === "number" ? { powerWatts: r.power } : {}),
              timerRunning,
            }
          : {}),
      };
    });
    const metricPoints = activity
      ? deriveRecordingMetrics(raw)
      : raw.map((p) => ({
          lat: p.lat,
          lng: p.lng,
          ...(p.ele === undefined ? {} : { ele: p.ele }),
        }));
    points = metricPoints.flatMap((p) => {
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) {
        gap = true;
        return [];
      }
      if (gap && sawValid) segment++;
      gap = false;
      sawValid = true;
      return [{ ...p, segment }];
    });
    waypoints = (messages.coursePointMesgs ?? [])
      .filter(
        (r) =>
          Number.isFinite(r.positionLat) && Number.isFinite(r.positionLong),
      )
      .map((r) => ({
        id: crypto.randomUUID(),
        name: String(r.name ?? "Garmin 點位"),
        note: "由 FIT 匯入",
        kind: "custom" as const,
        lat: (Number(r.positionLat) * 180) / 2 ** 31,
        lng: (Number(r.positionLong) * 180) / 2 ** 31,
      }));
    name = String(messages.courseMesgs?.[0]?.name ?? name);
  } else if (ext === "gpx" || ext === "tcx") {
    const parsed = await readXmlTrack(file, ext, progress);
    points = parsed.points;
    waypoints = parsed.waypoints;
    name = parsed.name || name;
  } else throw Error("請選擇 GPX、TCX、FIT 或路線 JSON 備份。");
  return compactImportedRoute(
    {
      name,
      points,
      waypoints,
      provenance: `使用者匯入 ${file.name}；保留可用的紀錄時刻、速度及10秒平均功率，不保留原始日期、心率等其他感測紀錄`,
    },
    progress,
  );
}
export function exportGpx(r: RouteData) {
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="620 Route Studio" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>${xml(r.name)}</name><desc>${xml(r.provenance)}</desc></metadata>${r.waypoints.map((w) => `<wpt lat="${w.lat}" lon="${w.lng}"><name>${xml(w.name)}</name><desc>${xml(w.note)}</desc><type>${xml(w.kind)}</type></wpt>`).join("")}<trk><name>${xml(r.name)}</name>${groups(
    r.points,
  )
    .map(
      (ps) =>
        `<trkseg>${ps.map((p) => `<trkpt lat="${p.lat}" lon="${p.lng}">${p.ele !== undefined ? `<ele>${p.ele}</ele>` : ""}</trkpt>`).join("")}</trkseg>`,
    )
    .join("")}</trk></gpx>`;
}
const base = Date.parse("2026-11-06T18:00:00+08:00");
const time = (meters: number) =>
  new Date(base + (meters / 25000) * 3600000).toISOString();
export function exportTcx(r: RouteData) {
  const ds = cumulative(r.points);
  let offset = 0;
  const pos = (p: TrackPoint) =>
    `<Position><LatitudeDegrees>${p.lat}</LatitudeDegrees><LongitudeDegrees>${p.lng}</LongitudeDegrees></Position>`;
  return `<?xml version="1.0" encoding="UTF-8"?><TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2 https://www8.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd"><Courses><Course><Name>TWB620-Edited</Name><Lap><TotalTimeSeconds>${(distance(r.points) / 25000) * 3600}</TotalTimeSeconds><DistanceMeters>${distance(r.points)}</DistanceMeters><BeginPosition><LatitudeDegrees>${r.points[0].lat}</LatitudeDegrees><LongitudeDegrees>${r.points[0].lng}</LongitudeDegrees></BeginPosition><EndPosition><LatitudeDegrees>${r.points.at(-1)!.lat}</LatitudeDegrees><LongitudeDegrees>${r.points.at(-1)!.lng}</LongitudeDegrees></EndPosition><Intensity>Active</Intensity></Lap>${groups(
    r.points,
  )
    .map(
      (ps) =>
        `<Track>${ps
          .map((p) => {
            const d = ds[offset++];
            return `<Trackpoint><Time>${time(d)}</Time>${pos(p)}${p.ele !== undefined ? `<AltitudeMeters>${p.ele}</AltitudeMeters>` : ""}<DistanceMeters>${d}</DistanceMeters></Trackpoint>`;
          })
          .join("")}</Track>`,
    )
    .join(
      "",
    )}<Notes>${xml(r.name)}; ${xml(r.provenance)}; 時間為25km/h產生的課程時間，非騎乘紀錄。點位不含自動轉彎指示。</Notes>${r.waypoints
    .map((w) => {
      const i = nearest(r.points, w).idx;
      return `<CoursePoint><Name>${xml(w.name)}</Name><Time>${time(ds[i])}</Time>${pos(w)}<PointType>${w.kind === "water" ? "Water" : w.kind === "food" ? "Food" : "Generic"}</PointType><Notes>${xml(w.note)}</Notes></CoursePoint>`;
    })
    .join("")}</Course></Courses></TrainingCenterDatabase>`;
}
export async function exportFit(r: RouteData) {
  if (groups(r.points).length > 1)
    throw Error("FIT 課程不支援此分段軌跡，請先整理成連續路線或匯出 GPX。");
  const { Encoder, Profile } = await import("@garmin/fitsdk");
  const encoder = new Encoder(),
    ds = cumulative(r.points);
  const write = (n: number, m: Record<string, unknown>) =>
    encoder.onMesg(n, m as import("@garmin/fitsdk").Mesg);
  const semicircle = (x: number) => Math.round((x * 2 ** 31) / 180);
  write(Profile.MesgNum.FILE_ID, {
    type: "course",
    manufacturer: "development",
    product: 1,
    serialNumber: 1,
    timeCreated: new Date(),
  });
  write(Profile.MesgNum.COURSE, {
    name: "TWB620-Edited",
    sport: "cycling",
    capabilities: 3,
  });
  write(Profile.MesgNum.LAP, {
    startTime: new Date(base),
    timestamp: new Date(time(ds.at(-1)!)),
    totalTimerTime: (ds.at(-1)! / 25000) * 3600,
    totalElapsedTime: (ds.at(-1)! / 25000) * 3600,
    totalDistance: ds.at(-1),
    startPositionLat: semicircle(r.points[0].lat),
    startPositionLong: semicircle(r.points[0].lng),
    endPositionLat: semicircle(r.points.at(-1)!.lat),
    endPositionLong: semicircle(r.points.at(-1)!.lng),
  });
  write(Profile.MesgNum.EVENT, {
    timestamp: new Date(base),
    event: "timer",
    eventType: "start",
  });
  const cues = r.waypoints
    .map((w) => ({ w, idx: nearest(r.points, w).idx }))
    .sort((a, b) => a.idx - b.idx);
  r.points.forEach((p, i) => {
    write(Profile.MesgNum.RECORD, {
      timestamp: new Date(time(ds[i])),
      positionLat: semicircle(p.lat),
      positionLong: semicircle(p.lng),
      distance: ds[i],
      ...(p.ele !== undefined ? { altitude: p.ele } : {}),
    });
    cues
      .filter((c) => c.idx === i)
      .forEach(({ w }) =>
        write(Profile.MesgNum.COURSE_POINT, {
          timestamp: new Date(time(ds[i])),
          positionLat: semicircle(w.lat),
          positionLong: semicircle(w.lng),
          distance: ds[i],
          name: w.name,
          type:
            w.kind === "water"
              ? "water"
              : w.kind === "food"
                ? "food"
                : "generic",
        }),
      );
  });
  write(Profile.MesgNum.EVENT, {
    timestamp: new Date(time(ds.at(-1)!)),
    event: "timer",
    eventType: "stopAll",
  });
  return encoder.close();
}
export function download(
  data: string | Uint8Array,
  filename: string,
  type: string,
) {
  const blob = new Blob(
    [typeof data === "string" ? data : new Uint8Array(data).buffer],
    { type },
  );
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
