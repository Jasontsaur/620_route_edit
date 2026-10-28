import { haversine, validPoint, type TrackPoint } from "./route";
import { recordingClock } from "./record-time";

// Timestamps and individual power samples are processing-only; returned points
// contain clock time and the requested derived metrics, never activity dates.
export type RecordingSample = TrackPoint & {
  timestampMs?: number;
  speedMps?: number;
  powerWatts?: number;
  timerRunning?: boolean;
};
export const fitEpochMs = Date.UTC(1989, 11, 31);
const nonnegative = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= 0;
const rounded = (n: number) => Math.round(n * 10) / 10;
export function deriveRecordingMetrics(
  samples: RecordingSample[],
): TrackPoint[] {
  const intervals: { start: number; end: number; power: number }[] = [];
  let energy = 0,
    covered = 0,
    head = 0;
  const clearPower = () => {
    intervals.length = 0;
    energy = covered = head = 0;
  };
  return samples.map((s, i) => {
    const previous = samples[i - 1];
    const time = s.timestampMs;
    const validTime =
      typeof time === "number" &&
      Number.isFinite(time) &&
      Math.abs(time) <= 8640000000000000;
    const dt =
      validTime && typeof previous?.timestampMs === "number"
        ? time - previous.timestampMs
        : NaN;
    const contiguous =
      previous &&
      (previous.segment ?? 0) === (s.segment ?? 0) &&
      s.timerRunning !== false &&
      previous.timerRunning !== false &&
      dt > 0;
    const point: TrackPoint = {
      lat: s.lat,
      lng: s.lng,
      ...(s.ele !== undefined ? { ele: s.ele } : {}),
      ...(s.segment !== undefined ? { segment: s.segment } : {}),
      ...(s.recordedTime ? { recordedTime: s.recordedTime } : {}),
    };
    if (validTime)
      point.recordedTime = recordingClock(new Date(time).toISOString());
    if (nonnegative(s.speedMps)) {
      point.recordedSpeedKmh = rounded(s.speedMps * 3.6);
      point.speedSource = "device";
    } else if (
      contiguous &&
      dt <= 10000 &&
      validPoint(s) &&
      validPoint(previous)
    ) {
      point.recordedSpeedKmh = rounded((haversine(previous, s) / dt) * 3600);
      point.speedSource = "gps";
    }
    // A reading represents its preceding sample interval. Require a complete
    // trailing 10 seconds; gaps >2s, missing power and timer pauses reset it.
    // Zero watts is a valid coasting reading and remains in the average.
    if (!contiguous || dt > 2000 || !nonnegative(s.powerWatts)) clearPower();
    else {
      intervals.push({ start: time! - dt, end: time!, power: s.powerWatts });
      energy += s.powerWatts * dt;
      covered += dt;
      const cutoff = time! - 10000;
      while (head < intervals.length && intervals[head].end <= cutoff) {
        const old = intervals[head++];
        energy -= old.power * (old.end - old.start);
        covered -= old.end - old.start;
      }
      if (head < intervals.length && intervals[head].start < cutoff) {
        const first = intervals[head],
          removed = cutoff - first.start;
        energy -= first.power * removed;
        covered -= removed;
        first.start = cutoff;
      }
      if (covered >= 10000 - 1e-6)
        point.recordedPower10sW = rounded(Math.max(0, energy / 10000));
      if (head > 64) {
        intervals.splice(0, head);
        head = 0;
      }
    }
    return point;
  });
}
