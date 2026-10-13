import { cumulative, type RouteData, type TrackPoint } from "./route";
export type MileageReference = Pick<RouteData, "name" | "points">;
export const alignmentRadius = 1000;
type Edge = {
  ax: number;
  ay: number;
  dx: number;
  dy: number;
  start: number;
  length: number;
  group: number;
};

// Spatial indexing avoids a full reference-track scan for every displayed point.
export function projector(reference: TrackPoint[], maxError = alignmentRadius) {
  const ds = cumulative(reference),
    origin = reference[0];
  const cos = Math.max(0.01, Math.cos((origin.lat * Math.PI) / 180));
  const xy = (p: TrackPoint) => [
    (((p.lng - origin.lng + 540) % 360) - 180) * 111195 * cos,
    (p.lat - origin.lat) * 111195,
  ];
  const edges: Edge[] = [],
    cells = new Map<string, number[]>(),
    long: number[] = [];
  let group = 0;
  for (let i = 1; i < reference.length; i++) {
    if ((reference[i].segment ?? 0) !== (reference[i - 1].segment ?? 0)) {
      group++;
      continue;
    }
    const [ax, ay] = xy(reference[i - 1]),
      [bx, by] = xy(reference[i]);
    const index =
      edges.push({
        ax,
        ay,
        dx: bx - ax,
        dy: by - ay,
        start: ds[i - 1],
        length: ds[i] - ds[i - 1],
        group,
      }) - 1;
    const x0 = Math.floor(Math.min(ax, bx) / alignmentRadius),
      x1 = Math.floor(Math.max(ax, bx) / alignmentRadius);
    const y0 = Math.floor(Math.min(ay, by) / alignmentRadius),
      y1 = Math.floor(Math.max(ay, by) / alignmentRadius);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 1000) {
      long.push(index);
      continue;
    }
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const key = `${x},${y}`,
          bucket = cells.get(key);
        if (bucket) bucket.push(index);
        else cells.set(key, [index]);
      }
  }
  return (p: TrackPoint, previous?: number) => {
    const [px, py] = xy(p),
      gx = Math.floor(px / alignmentRadius),
      gy = Math.floor(py / alignmentRadius);
    const candidates = new Set(long);
    for (let x = gx - 1; x <= gx + 1; x++)
      for (let y = gy - 1; y <= gy + 1; y++)
        for (const index of cells.get(`${x},${y}`) ?? []) candidates.add(index);
    // Point locations may be outside the route (including approximate checkpoint coordinates).
    // For those, use the closest reference segment and report the offset separately.
    if (maxError === Infinity)
      for (let i = 0; i < edges.length; i++) candidates.add(i);
    const matches: { meters: number; error: number; group: number }[] = [];
    for (const index of candidates) {
      const e = edges[index],
        t = Math.max(
          0,
          Math.min(
            1,
            ((px - e.ax) * e.dx + (py - e.ay) * e.dy) /
              (e.dx ** 2 + e.dy ** 2 || 1),
          ),
        );
      const error = Math.hypot(px - e.ax - t * e.dx, py - e.ay - t * e.dy);
      if (error <= maxError)
        matches.push({ meters: e.start + t * e.length, error, group: e.group });
    }
    if (!matches.length) return null;
    matches.sort((a, b) => a.error - b.error);
    const best = matches[0];
    if (previous === undefined) return best;
    // Prefer continuity only when positions are effectively equally close (junctions/laps).
    return matches
      .filter((m) => m.error <= best.error + 5)
      .sort(
        (a, b) => Math.abs(a.meters - previous) - Math.abs(b.meters - previous),
      )[0];
  };
}

export function referenceWaypoints(
  route: RouteData,
  reference: MileageReference,
) {
  const project = projector(reference.points, Infinity);
  return route.waypoints
    .map((waypoint) => {
      const match = project(waypoint);
      return {
        waypoint,
        meters: match?.meters ?? null,
        offset: match?.error ?? null,
      };
    })
    .sort((a, b) => (a.meters ?? Infinity) - (b.meters ?? Infinity));
}

export function mileageSpan(points: TrackPoint[], reference: MileageReference) {
  const project = projector(reference.points);
  let start = Infinity,
    end = -Infinity,
    previous: number | undefined;
  points.forEach((p, i) => {
    if (i && (p.segment ?? 0) !== (points[i - 1].segment ?? 0))
      previous = undefined;
    const match = project(p, previous);
    previous = match?.meters;
    if (match) {
      start = Math.min(start, match.meters);
      end = Math.max(end, match.meters);
    }
  });
  return Number.isFinite(start) ? { start, end } : null;
}
