export type TrackPoint = {
  lat: number;
  lng: number;
  ele?: number;
  segment?: number;
};
export type Waypoint = TrackPoint & {
  id: string;
  name: string;
  kind: "checkpoint" | "water" | "food" | "rest" | "custom";
  note: string;
  officialKm?: number;
  cutoff?: string;
  accuracy?: string;
  source?: string;
};
export type RouteData = {
  name: string;
  points: TrackPoint[];
  waypoints: Waypoint[];
  provenance: string;
  sourceUrl?: string;
  parentId?: string;
};
export const officialUrl = "https://www.twbike.org/activity/?act=data&id=395";
export const stravaUrl = "https://www.strava.com/routes/3539876578391353394";
export function validPoint(p: unknown): p is TrackPoint {
  const v = p as TrackPoint;
  return (
    !!v &&
    Number.isFinite(v.lat) &&
    Number.isFinite(v.lng) &&
    Math.abs(v.lat) <= 90 &&
    Math.abs(v.lng) <= 180 &&
    (v.ele === undefined || Number.isFinite(v.ele))
  );
}
export function haversine(a: TrackPoint, b: TrackPoint) {
  const r = Math.PI / 180;
  const dlat = (b.lat - a.lat) * r,
    dlng = (b.lng - a.lng) * r;
  const h =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dlng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
export function cumulative(points: TrackPoint[]) {
  let d = 0;
  return points.map((p, i) => {
    if (i && (p.segment ?? 0) === (points[i - 1].segment ?? 0))
      d += haversine(points[i - 1], p);
    return d;
  });
}
export function distance(points: TrackPoint[]) {
  return cumulative(points).at(-1) ?? 0;
}
// Iterative Ramer–Douglas–Peucker in local metre coordinates; retain segment endpoints.
export function simplify(points: TrackPoint[], tolerance: number) {
  if (!Number.isFinite(tolerance) || tolerance < 1 || tolerance > 50)
    throw Error("簡化容差需為 1–50 公尺。");
  return groups(points).flatMap((ps) => {
    if (ps.length <= 2) return ps;
    const keep = new Set([0, ps.length - 1]),
      stack = [[0, ps.length - 1]];
    while (stack.length) {
      const [start, end] = stack.pop()!,
        a = ps[start],
        b = ps[end],
        cos = Math.cos((a.lat * Math.PI) / 180);
      const dx = (b.lng - a.lng) * cos * 111195,
        dy = (b.lat - a.lat) * 111195;
      let best = -1,
        max = tolerance * tolerance;
      for (let i = start + 1; i < end; i++) {
        const x = (ps[i].lng - a.lng) * cos * 111195,
          y = (ps[i].lat - a.lat) * 111195;
        const t = Math.max(
          0,
          Math.min(1, (x * dx + y * dy) / (dx * dx + dy * dy || 1)),
        );
        const d = (x - t * dx) ** 2 + (y - t * dy) ** 2;
        if (d > max) {
          max = d;
          best = i;
        }
      }
      if (best !== -1) {
        keep.add(best);
        stack.push([start, best], [best, end]);
      }
    }
    return [...keep].sort((a, b) => a - b).map((i) => ps[i]);
  });
}
export function groups(points: TrackPoint[]) {
  const result: TrackPoint[][] = [];
  points.forEach((p, i) => {
    if (!i || (p.segment ?? 0) !== (points[i - 1].segment ?? 0))
      result.push([]);
    result.at(-1)!.push(p);
  });
  return result;
}
export function nearest(points: TrackPoint[], p: TrackPoint) {
  let idx = 0,
    min = Infinity;
  points.forEach((v, i) => {
    const d = haversine(v, p);
    if (d < min) {
      min = d;
      idx = i;
    }
  });
  return { idx, meters: min };
}
export function nearestSegment(points: TrackPoint[], p: TrackPoint) {
  let best = 1,
    min = Infinity;
  const cos = Math.cos((p.lat * Math.PI) / 180);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    if ((a.segment ?? 0) !== (b.segment ?? 0)) continue;
    const ax = (a.lng - p.lng) * cos,
      ay = a.lat - p.lat,
      bx = (b.lng - p.lng) * cos,
      by = b.lat - p.lat;
    const dx = bx - ax,
      dy = by - ay;
    const t = Math.max(
      0,
      Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)),
    );
    const d = (ax + t * dx) ** 2 + (ay + t * dy) ** 2;
    if (d < min) {
      min = d;
      best = i;
    }
  }
  return best;
}
export function validateRoute(data: unknown): RouteData {
  const r = data as RouteData;
  const bounded = (v: unknown, max: number) =>
    v === undefined || (typeof v === "string" && v.length <= max);
  const point = (p: unknown) =>
    validPoint(p) &&
    ((p as TrackPoint).segment === undefined ||
      (Number.isSafeInteger((p as TrackPoint).segment) &&
        (p as TrackPoint).segment! >= 0));
  if (
    !r ||
    typeof r.name !== "string" ||
    !r.name.trim() ||
    r.name.length > 120 ||
    !Array.isArray(r.points) ||
    r.points.length < 2 ||
    r.points.length > 50000 ||
    !r.points.every(point) ||
    !Array.isArray(r.waypoints) ||
    r.waypoints.length > 500 ||
    !r.waypoints.every(
      (w) =>
        point(w) &&
        typeof w.id === "string" &&
        w.id.length > 0 &&
        w.id.length <= 100 &&
        typeof w.name === "string" &&
        w.name.trim().length > 0 &&
        w.name.length <= 120 &&
        typeof w.note === "string" &&
        w.note.length <= 3000 &&
        ["checkpoint", "water", "food", "rest", "custom"].includes(w.kind) &&
        (w.officialKm === undefined ||
          (Number.isFinite(w.officialKm) && w.officialKm >= 0)) &&
        bounded(w.accuracy, 500) &&
        bounded(w.source, 2000) &&
        (w.cutoff === undefined ||
          (typeof w.cutoff === "string" &&
            Number.isFinite(Date.parse(w.cutoff)))),
    ) ||
    new Set(r.waypoints.map((w) => w.id)).size !== r.waypoints.length ||
    typeof r.provenance !== "string" ||
    r.provenance.length > 3000 ||
    !bounded(r.sourceUrl, 2000) ||
    !bounded(r.parentId, 100)
  )
    throw Error(
      "路線資料無效：需有 2–50,000 個有效軌跡點，最多 500 個點位；請檢查名稱與座標。",
    );
  return r;
}
export const checkpointSeed: Waypoint[] = [
  {
    id: "start",
    name: "福隆遊客中心",
    lat: 25.01695,
    lng: 121.94273,
    kind: "checkpoint",
    note: "起點｜台2 100K",
    officialKm: 0,
    cutoff: "2026-11-06T18:20:00+08:00",
    accuracy: "官方軌跡起點",
  },
  {
    id: "cp1",
    name: "富貴角・楓林橋",
    lat: 25.2889265,
    lng: 121.5424815,
    kind: "checkpoint",
    note: "檢1｜台2 25K｜無補給；非燈塔本體",
    officialKm: 75,
    cutoff: "2026-11-06T22:00:00+08:00",
    accuracy: "OSM 楓林橋地標座標；感應門待確認",
    source:
      "https://taiwanjiedao.openalfa.com/街道/楓林橋-燈臺口-富基里-石門區",
  },
  {
    id: "cp2",
    name: "新竹・香山風情海岸",
    lat: 24.7593,
    lng: 120.9113,
    kind: "checkpoint",
    note: "檢2｜台15 79K｜提供水",
    officialKm: 185,
    cutoff: "2026-11-07T04:00:00+08:00",
    accuracy: "依公告地名估位，待核對感應門",
  },
  {
    id: "cp3",
    name: "彰化・王功福海宮",
    lat: 23.953256,
    lng: 120.334073,
    kind: "checkpoint",
    note: "檢3｜台17 54K｜提供補給",
    officialKm: 305,
    cutoff: "2026-11-07T11:00:00+08:00",
    accuracy: "廟方公布座標；感應門待確認",
    source: "https://www.fuhaigong.org.tw/07.php",
  },
  {
    id: "cp4",
    name: "台南・將軍吉安宮",
    lat: 23.206499,
    lng: 120.134102,
    kind: "checkpoint",
    note: "檢4｜台17 150K｜提供補給",
    officialKm: 405,
    cutoff: "2026-11-07T17:00:00+08:00",
    accuracy: "公開地標座標；感應門待確認",
    source: "https://folk.tw/temples/moi_923_吉安宮/",
  },
  {
    id: "cp5",
    name: "國聖燈塔檢查點",
    lat: 23.1004,
    lng: 120.0365,
    kind: "checkpoint",
    note: "檢5｜縣道173｜無補給",
    officialKm: 425,
    cutoff: "2026-11-07T18:00:00+08:00",
    accuracy: "燈塔周邊估位，待核對感應門",
  },
  {
    id: "cp6",
    name: "屏東・東港立德傢俱",
    lat: 22.4668,
    lng: 120.4665,
    kind: "checkpoint",
    note: "檢6｜台17 257K｜提供補給｜公開店址：東港鎮船頭路75號之43，座標與感應門待核對",
    officialKm: 525,
    cutoff: "2026-11-07T23:00:00+08:00",
    accuracy: "依台17 257K估位，待確認店址及感應門",
    source: "https://www.iyp.com.tw/088352380",
  },
  {
    id: "finish",
    name: "鵝鑾鼻・海山露營區",
    lat: 21.90968,
    lng: 120.84833,
    kind: "checkpoint",
    note: "終點｜台26 42K｜提供補給；非燈塔本體",
    officialKm: 615,
    cutoff: "2026-11-08T04:00:00+08:00",
    accuracy: "官方軌跡終點",
  },
];
