import {
  cumulative,
  distance,
  validPoint,
  validateRoute,
  type RouteData,
  type TrackPoint,
} from "./route";
export type ImportSummary = {
  before: number;
  after: number;
  beforeMeters: number;
  afterMeters: number;
  tolerance: number;
  heightTolerance: number;
};
export type ImportProgress = { message: string; summary?: ImportSummary };

export function thinTrack(
  points: TrackPoint[],
  tolerance: number,
  heightTolerance: number,
) {
  if (points.length <= 2) return points;
  const ds = cumulative(points),
    pins = new Set([0, points.length - 1]);
  let anchor = 0;
  for (let i = 1; i < points.length; i++) {
    if (
      (points[i].segment ?? 0) !== (points[i - 1].segment ?? 0) ||
      (points[i].ele === undefined) !== (points[i - 1].ele === undefined)
    ) {
      pins.add(i - 1);
      pins.add(i);
      anchor = ds[i];
    } else if (ds[i] - anchor >= 500) {
      pins.add(i);
      anchor = ds[i];
    }
  }
  const ordered = [...pins].sort((a, b) => a - b),
    keep = new Set(ordered);
  for (let k = 1; k < ordered.length; k++) {
    const stack = [[ordered[k - 1], ordered[k]]];
    while (stack.length) {
      const [start, end] = stack.pop()!;
      if (
        end - start < 2 ||
        (points[start].segment ?? 0) !== (points[end].segment ?? 0)
      )
        continue;
      const a = points[start],
        b = points[end],
        cos = Math.cos((a.lat * Math.PI) / 180);
      const dx = (((b.lng - a.lng + 540) % 360) - 180) * cos * 111195,
        dy = (b.lat - a.lat) * 111195;
      let best = -1,
        worst = 1;
      for (let i = start + 1; i < end; i++) {
        const px = (((points[i].lng - a.lng + 540) % 360) - 180) * cos * 111195,
          py = (points[i].lat - a.lat) * 111195;
        const t = Math.max(
          0,
          Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy || 1)),
        );
        let error = Math.hypot(px - t * dx, py - t * dy) / tolerance;
        if (
          a.ele !== undefined &&
          b.ele !== undefined &&
          points[i].ele !== undefined
        ) {
          const f = (ds[i] - ds[start]) / (ds[end] - ds[start] || 1);
          error = Math.max(
            error,
            Math.abs(points[i].ele! - (a.ele + f * (b.ele - a.ele))) /
              heightTolerance,
          );
        }
        if (error > worst) {
          worst = error;
          best = i;
        }
      }
      if (best >= 0) {
        keep.add(best);
        stack.push([start, best], [best, end]);
      }
    }
  }
  return [...keep].sort((a, b) => a - b).map((i) => points[i]);
}

export function compactImportedRoute(
  input: unknown,
  progress?: (p: ImportProgress) => void,
): RouteData {
  const route = input as RouteData;
  if (!route || !Array.isArray(route.points) || !Array.isArray(route.waypoints))
    return validateRoute(input);
  const endpoints = (ps: TrackPoint[]) =>
    Array.isArray(ps) && ps.length > 2 ? [ps[0], ps.at(-1)!] : ps;
  // Check all metadata/waypoints before simplifying, then every raw coordinate below.
  validateRoute({
    ...route,
    points: endpoints(route.points),
    ...(Array.isArray(route.overlays)
      ? {
          overlays: route.overlays.map((l) => ({
            ...l,
            points: endpoints(l.points),
          })),
        }
      : {}),
  });
  let before = 0,
    after = 0,
    beforeMeters = 0,
    afterMeters = 0,
    tolerance = 0,
    heightTolerance = 0;
  const reduce = (ps: TrackPoint[]) => {
    if (ps.length > 1000000) throw Error("原始軌跡超過 100 萬點，請分段匯入。");
    if (
      !ps.every(
        (p) =>
          validPoint(p) &&
          (p.segment === undefined ||
            (Number.isSafeInteger(p.segment) && p.segment >= 0)),
      )
    )
      throw Error("軌跡包含無效座標或分段，無法自動瘦身。");
    before += ps.length;
    let result = ps;
    if (ps.length > 12000) {
      progress?.({
        message: `正在自動瘦身：${ps.length.toLocaleString()} 個軌跡點…`,
      });
      beforeMeters += distance(ps);
      for (const [geo, height] of [
        [2, 1],
        [5, 2],
        [10, 3],
        [20, 5],
        [50, 10],
      ]) {
        result = thinTrack(ps, geo, height);
        tolerance = Math.max(tolerance, geo);
        heightTolerance = Math.max(heightTolerance, height);
        if (result.length <= 12000) break;
      }
      if (result.length > 50000)
        throw Error(
          "軌跡含過多必須保留的分段或高度斷點，無法安全縮至 50,000 點；請分段匯入。",
        );
      afterMeters += distance(result);
    } else {
      const meters = distance(ps);
      beforeMeters += meters;
      afterMeters += meters;
    }
    after += result.length;
    return result;
  };
  const points = reduce(route.points);
  const overlays = route.overlays?.map((l) => ({
    ...l,
    points: reduce(l.points),
  }));
  if (before === after) return validateRoute(route);
  const summary = {
    before,
    after,
    beforeMeters,
    afterMeters,
    tolerance,
    heightTolerance,
  };
  const note = `；自動瘦身 ${before}→${after} 點（位置容差≤${tolerance}m、高度容差≤${heightTolerance}m）`;
  const result = validateRoute({
    ...route,
    points,
    ...(overlays ? { overlays } : {}),
    provenance:
      route.provenance.length + note.length <= 3000
        ? route.provenance + note
        : route.provenance,
  });
  progress?.({ message: "自動瘦身完成", summary });
  return result;
}
