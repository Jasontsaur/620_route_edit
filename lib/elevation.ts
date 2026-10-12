import {
  activeRouteColor,
  cumulative,
  overlayColor,
  type RouteData,
  type TrackPoint,
} from "./route";

export const alignmentRadius = 1000;
export function elevationLayers(route: RouteData) {
  return [
    ...(route.overlays ?? []).map((layer, i) => ({
      ...layer,
      id: `overlay:${layer.id}`,
      color: overlayColor(i),
    })),
    {
      id: "active",
      name: route.name,
      points: route.points,
      color: activeRouteColor,
    },
  ];
}
export function kilometerTicks(meters: number) {
  return Array.from(
    { length: Math.floor(Math.max(0, meters) / 50000) + 1 },
    (_, i) => i * 50000,
  );
}
type Sample = TrackPoint & { meters: number; elevation: number };
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
function projector(reference: TrackPoint[]) {
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
      if (error <= alignmentRadius)
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

// Retain endpoints and local extrema; source run IDs preserve missing-height/GPS gaps.
function sampleIndices(points: TrackPoint[]) {
  const indices = new Set<number>(),
    runs: number[] = [];
  let run = 0;
  points.forEach((p, i) => {
    if (
      i &&
      (p.ele === undefined ||
        points[i - 1].ele === undefined ||
        (p.segment ?? 0) !== (points[i - 1].segment ?? 0))
    )
      run++;
    runs.push(run);
  });
  const stride = Math.max(1, Math.ceil(points.length / 800));
  for (let start = 0; start < points.length; start += stride) {
    let first = -1,
      last = -1,
      low = -1,
      high = -1;
    for (let i = start; i < Math.min(points.length, start + stride); i++) {
      if (points[i].ele === undefined) continue;
      if (first < 0) first = low = high = i;
      last = i;
      if (points[i].ele! < points[low].ele!) low = i;
      if (points[i].ele! > points[high].ele!) high = i;
    }
    if (first >= 0) for (const i of [first, low, high, last]) indices.add(i);
  }
  return { indices: [...indices].sort((a, b) => a - b), runs };
}

export function buildElevationProfile(route: RouteData, referenceId?: string) {
  const layers = elevationLayers(route),
    reference = layers.find((l) => l.id === referenceId) ?? layers[0];
  const project = projector(reference.points),
    referenceDs = cumulative(reference.points);
  const profiles = layers.map((layer) => {
    const { indices, runs } = sampleIndices(layer.points),
      sourceDs = cumulative(layer.points);
    const paths: Sample[][] = [];
    let previous: number | undefined,
      previousIndex = -1,
      previousGroup = -1,
      unmatched = 0;
    for (const i of indices) {
      const p = layer.points[i];
      if (previousIndex >= 0 && runs[i] !== runs[previousIndex])
        previous = undefined;
      const match =
        layer.id === reference.id
          ? { meters: referenceDs[i], group: runs[i] }
          : project(p, previous);
      if (!match) {
        unmatched++;
        previous = undefined;
        previousIndex = i;
        continue;
      }
      if (
        previous === undefined ||
        runs[i] !== runs[previousIndex] ||
        match.group !== previousGroup ||
        Math.abs(match.meters - previous) >
          (sourceDs[i] - sourceDs[previousIndex]) * 2 + 1000
      )
        paths.push([]);
      paths
        .at(-1)!
        .push({
          lat: p.lat,
          lng: p.lng,
          meters: match.meters,
          elevation: p.ele!,
        });
      previous = match.meters;
      previousIndex = i;
      previousGroup = match.group;
    }
    return {
      id: layer.id,
      name: layer.name,
      color: layer.color,
      paths,
      unmatched,
      hasElevation: indices.length > 0,
    };
  });
  let min = 0,
    max = 50;
  for (const profile of profiles)
    for (const path of profile.paths)
      for (const p of path) {
        min = Math.min(min, p.elevation);
        max = Math.max(max, p.elevation);
      }
  const rough = (max - min) / 4,
    power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].find((v) => v * power >= rough)! * power;
  const minElevation = Math.floor(min / step) * step,
    maxElevation = Math.ceil(max / step) * step;
  const elevationTicks = Array.from(
    { length: Math.round((maxElevation - minElevation) / step) + 1 },
    (_, i) => minElevation + i * step,
  );
  const meters = referenceDs.at(-1) ?? 0;
  return {
    reference,
    profiles,
    meters,
    ticks: kilometerTicks(meters),
    minElevation,
    maxElevation,
    elevationTicks,
  };
}

export type MapViewport = {
  south: number;
  north: number;
  west: number;
  east: number;
};
export type MileageRange = { start: number; end: number };

function visibleFraction(a: TrackPoint, b: TrackPoint, bounds: MapViewport) {
  const span =
    bounds.east >= bounds.west
      ? bounds.east - bounds.west
      : bounds.east - bounds.west + 360;
  const ax = (((a.lng - bounds.west) % 360) + 360) % 360;
  const dx = ((b.lng - a.lng + 540) % 360) - 180;
  let first = Infinity,
    last = -Infinity;
  for (const shift of [-360, 0, 360]) {
    let start = 0,
      end = 1;
    const clip = (origin: number, delta: number, low: number, high: number) => {
      if (Math.abs(delta) < 1e-12) return origin >= low && origin <= high;
      const t0 = (low - origin) / delta,
        t1 = (high - origin) / delta;
      start = Math.max(start, Math.min(t0, t1));
      end = Math.min(end, Math.max(t0, t1));
      return start <= end;
    };
    if (!clip(a.lat, b.lat - a.lat, bounds.south, bounds.north)) continue;
    if (span < 360 && !clip(ax + shift, dx, 0, span)) continue;
    first = Math.min(first, start);
    last = Math.max(last, end);
  }
  return first === Infinity ? null : { start: first, end: last };
}

export function visibleMileageRange(
  profile: ReturnType<typeof buildElevationProfile>,
  viewport: MapViewport | null,
): MileageRange | null {
  if (!viewport) return { start: 0, end: profile.meters };
  let start = Infinity,
    end = -Infinity;
  const include = (
    a: TrackPoint & { meters: number },
    b: TrackPoint & { meters: number },
  ) => {
    const part = visibleFraction(a, b, viewport);
    if (!part) return;
    const first = a.meters + (b.meters - a.meters) * part.start;
    const last = a.meters + (b.meters - a.meters) * part.end;
    start = Math.min(start, first, last);
    end = Math.max(end, first, last);
  };
  // Full reference geometry keeps viewport edges accurate even without height samples.
  const points = profile.reference.points,
    ds = cumulative(points);
  points.forEach((p, i) => {
    const b = { ...p, meters: ds[i] };
    include(b, b);
    if (i && (p.segment ?? 0) === (points[i - 1].segment ?? 0))
      include({ ...points[i - 1], meters: ds[i - 1] }, b);
  });
  // Also include visible aligned curves when the reference itself is just outside the map.
  for (const layer of profile.profiles)
    for (const path of layer.paths)
      path.forEach((p, i) => {
        include(p, p);
        if (i) include(path[i - 1], p);
      });
  return start === Infinity ? null : { start, end };
}

export function mileageRangeTicks(range: MileageRange) {
  const ticks: number[] = [];
  for (
    let d = Math.ceil(range.start / 50000) * 50000;
    d <= range.end;
    d += 50000
  )
    ticks.push(d);
  const clearance = (range.end - range.start) * 0.06;
  if (!ticks.length || ticks[0] - range.start > clearance)
    ticks.unshift(range.start);
  if (range.end - ticks[ticks.length - 1] > clearance) ticks.push(range.end);
  return ticks;
}
