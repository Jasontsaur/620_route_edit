import { nearest, type TrackPoint } from "./route";
import type { projector } from "./mileage";
const clockFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Taipei",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
export function recordingClock(iso: unknown) {
  if (
    typeof iso !== "string" ||
    !/(?:Z|[+-]\d{2}:\d{2})$/.test(iso) ||
    !Number.isFinite(Date.parse(iso))
  )
    return undefined;
  return clockFormat.format(new Date(iso));
}
// Report an actual retained GPS sample, never an interpolated/estimated time.
export function recordedPointAt(points: TrackPoint[], position: TrackPoint) {
  if (!points.length) return null;
  const point = points[nearest(points, position).idx];
  return point.recordedTime ? point : null;
}

// Match each retained recording sample to the fixed route in travel order so
// a clicked time, speed and mileage always describe the same GPS sample.
export function recordedMileageByPoint(
  points: TrackPoint[],
  project: ReturnType<typeof projector>,
) {
  const meters = new WeakMap<TrackPoint, number>();
  let previous: number | undefined;
  for (const point of points) {
    const match = project(point, previous);
    previous = match?.meters;
    if (match) meters.set(point, match.meters);
  }
  return meters;
}
