import { SaxesParser } from "saxes";
import { validPoint, type Waypoint } from "./route";
import type { ImportProgress } from "./compact-import";
import { deriveRecordingMetrics, type RecordingSample } from "./record-metrics";
type Candidate = {
  tag: string;
  depth: number;
  lat: number;
  lng: number;
  ele?: number;
  timestampMs?: number;
  speedMps?: number;
  powerWatts?: number;
  name: string;
  note: string;
  hasPosition: boolean;
};

export async function readXmlTrack(
  file: File,
  format: "gpx" | "tcx",
  progress?: (p: ImportProgress) => void,
) {
  const parser = new SaxesParser({ xmlns: true });
  const stack: { name: string; text: string; uri: string }[] = [];
  const capture = new Set([
    "ele",
    "AltitudeMeters",
    "LatitudeDegrees",
    "LongitudeDegrees",
    "name",
    "Name",
    "desc",
    "Notes",
    "time",
    "Time",
    "Speed",
    "Watts",
  ]);
  const tracks: RecordingSample[] = [],
    routes: RecordingSample[] = [],
    waypoints: Waypoint[] = [];
  let candidate: Candidate | undefined,
    skipDepth = 0,
    trackSegment = -1,
    routeSegment = -1;
  let tcxSegment = -1,
    nextTcxSegment = 0,
    gap = false,
    sawValid = false,
    courseCount = 0;
  let trackName = "",
    routeName = "",
    courseName = "";
  const number = (s: string | undefined) => (s?.trim() ? Number(s) : NaN);
  parser.on("error", () => {
    throw Error("XML 格式不正確，請重新匯出紀錄。");
  });
  parser.on("opentag", (tag) => {
    stack.push({ name: tag.local, text: "", uri: tag.uri });
    if (skipDepth) return;
    if (
      format === "tcx" &&
      stack.slice(0, -1).some((t) => t.name.toLowerCase() === "extensions") &&
      tag.uri !== "http://www.garmin.com/xmlschemas/ActivityExtension/v2"
    ) {
      skipDepth = stack.length;
      return;
    }
    if (tag.local.toLowerCase() === "extensions" && format !== "tcx") {
      skipDepth = stack.length;
      return;
    }
    if (format === "gpx" && tag.local === "trkseg") trackSegment++;
    if (format === "gpx" && tag.local === "rte") routeSegment++;
    if (format === "tcx" && tag.local === "Course" && ++courseCount > 1)
      throw Error("TCX 含多條 Course，請分別匯入單條路線。");
    if (format === "tcx" && tag.local === "Track") {
      tcxSegment = nextTcxSegment++;
      gap = false;
      sawValid = false;
    }
    const accepted =
      format === "gpx"
        ? ["trkpt", "rtept", "wpt"]
        : ["Trackpoint", "CoursePoint"];
    if (!accepted.includes(tag.local)) return;
    if (candidate) throw Error("XML 軌跡點不應互相巢狀。");
    candidate = {
      tag: tag.local,
      depth: stack.length,
      lat: number(tag.attributes.lat?.value),
      lng: number(tag.attributes.lon?.value),
      name: "",
      note: "",
      hasPosition: false,
    };
  });
  const onText = (s: string) => {
    if (skipDepth) return;
    const current = stack.at(-1);
    if (current && capture.has(current.name)) {
      current.text += s;
      if (current.text.length > 5000)
        throw Error("點位名稱或備註過長，請縮短後匯入。");
    }
  };
  parser.on("text", onText);
  parser.on("cdata", onText);
  parser.on("closetag", () => {
    const depth = stack.length,
      current = stack.pop()!;
    if (skipDepth) {
      if (depth === skipDepth) skipDepth = 0;
      return;
    }
    if (candidate && stack.length >= candidate.depth) {
      const v = current.text;
      const activityPoint =
        format === "gpx"
          ? candidate.tag === "trkpt"
          : stack.some((t) => t.name === "Activity");
      if (
        activityPoint &&
        (current.name === "time" || current.name === "Time")
      ) {
        if (
          /(?:Z|[+-]\d{2}:\d{2})$/.test(v.trim()) &&
          Number.isFinite(Date.parse(v))
        )
          candidate.timestampMs = Date.parse(v);
      }
      if (
        activityPoint &&
        format === "tcx" &&
        current.uri === "http://www.garmin.com/xmlschemas/ActivityExtension/v2"
      ) {
        if (
          current.name === "Speed" &&
          Number.isFinite(number(v)) &&
          number(v) >= 0
        )
          candidate.speedMps = number(v);
        if (
          current.name === "Watts" &&
          Number.isFinite(number(v)) &&
          number(v) >= 0
        )
          candidate.powerWatts = number(v);
      }
      if (stack.some((t) => t.name.toLowerCase() === "extensions")) return;
      if (current.name === "ele" || current.name === "AltitudeMeters") {
        const ele = number(v);
        if (Number.isFinite(ele)) candidate.ele = ele;
      } else if (current.name === "LatitudeDegrees") {
        candidate.lat = number(v);
        candidate.hasPosition ||= !!v.trim();
      } else if (current.name === "LongitudeDegrees") {
        candidate.lng = number(v);
        candidate.hasPosition ||= !!v.trim();
      } else if (current.name === "name" || current.name === "Name")
        candidate.name = v;
      else if (current.name === "desc" || current.name === "Notes")
        candidate.note = v;
    }
    if (current.name === "name" && stack.at(-1)?.name === "trk" && !trackName)
      trackName = current.text;
    if (current.name === "name" && stack.at(-1)?.name === "rte" && !routeName)
      routeName = current.text;
    if (
      current.name === "Name" &&
      stack.at(-1)?.name === "Course" &&
      !courseName
    )
      courseName = current.text;
    if (
      !candidate ||
      candidate.tag !== current.name ||
      depth !== candidate.depth
    )
      return;
    const c = candidate;
    candidate = undefined;
    if (c.tag === "wpt" || c.tag === "CoursePoint") {
      if (c.tag === "CoursePoint" && !c.hasPosition) return;
      waypoints.push({
        id: crypto.randomUUID(),
        name: c.name || "匯入點位",
        note: c.note,
        kind: "custom",
        lat: c.lat,
        lng: c.lng,
      });
      if (waypoints.length > 500)
        throw Error("匯入點位超過 500 個，請分段匯入；不會自動刪除點位。");
      return;
    }
    if (
      c.tag === "Trackpoint" &&
      (!Number.isFinite(c.lat) || !Number.isFinite(c.lng))
    ) {
      gap = true;
      return;
    }
    if (c.tag === "Trackpoint" && gap && sawValid)
      tcxSegment = nextTcxSegment++;
    gap = false;
    sawValid = true;
    const p = {
      lat: c.lat,
      lng: c.lng,
      segment:
        c.tag === "Trackpoint"
          ? tcxSegment
          : c.tag === "rtept"
            ? routeSegment
            : trackSegment,
      ...(c.ele !== undefined ? { ele: c.ele } : {}),
      ...(c.timestampMs !== undefined ? { timestampMs: c.timestampMs } : {}),
      ...(c.speedMps !== undefined ? { speedMps: c.speedMps } : {}),
      ...(c.powerWatts !== undefined ? { powerWatts: c.powerWatts } : {}),
    };
    if (!validPoint(p) || p.segment < 0)
      throw Error("軌跡含無效座標或缺少 Track／trkseg。");
    (c.tag === "rtept" ? routes : tracks).push(p);
    if (tracks.length + routes.length > 1000000)
      throw Error("原始軌跡超過 100 萬點，請分段匯入。");
  });
  const reader = file.stream().getReader(),
    decoder = new TextDecoder();
  let read = 0,
    lastReport = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      parser.write(decoder.decode(chunk.value, { stream: true }));
      read += chunk.value.byteLength;
      if (read - lastReport >= 1000000) {
        lastReport = read;
        progress?.({
          message: `正在解析軌跡：${Math.min(100, Math.round((read / (file.size || 1)) * 100))}%…`,
        });
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
    parser.write(decoder.decode()).close();
  } catch (error) {
    await reader.cancel();
    throw error;
  } finally {
    reader.releaseLock();
  }
  return {
    points: tracks.length ? deriveRecordingMetrics(tracks) : routes,
    waypoints,
    name: format === "tcx" ? courseName : tracks.length ? trackName : routeName,
  };
}
