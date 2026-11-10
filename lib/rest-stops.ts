import { haversine, type TrackPoint } from "./route";

export type TimedTrackPoint = TrackPoint & { timestampMs: number };
export type RestStop = {
  id: string;
  lat: number;
  lng: number;
  durationMinutes: number;
  inferredFromGap: boolean;
  intervalCount: number;
};

type Candidate = {
  lat: number;
  lng: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  inferredFromGap: boolean;
  intervalCount: number;
};

const MAX_SAMPLE_GAP_MS = 10000;
const MIN_REST_MS = 60000;
const MAX_GAP_DISTANCE_M = 100;
const MERGE_TIME_MS = 300000;
const MERGE_DISTANCE_M = 100;

// Garmin auto-pause omits most samples during this ride's rests. A long gap
// between nearby positions is an inference, not observed continuous speed.
export function detectRestStops(points: TimedTrackPoint[]): RestStop[] {
  const candidates: Candidate[] = [];
  let slow: Candidate | null = null;
  const finishSlow = () => {
    if (slow && slow.durationMs > MIN_REST_MS) candidates.push(slow);
    slow = null;
  };
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1];
    const current = points[i];
    const elapsed = current.timestampMs - previous.timestampMs;
    if (
      !Number.isFinite(previous.timestampMs) ||
      !Number.isFinite(current.timestampMs) ||
      (previous.segment ?? 0) !== (current.segment ?? 0) ||
      elapsed <= 0
    ) {
      finishSlow();
      continue;
    }
    const moved = haversine(previous, current);
    const speedKmh = (moved / elapsed) * 3600;
    if (elapsed > MAX_SAMPLE_GAP_MS) {
      finishSlow();
      if (elapsed > MIN_REST_MS && moved <= MAX_GAP_DISTANCE_M && speedKmh < 5)
        candidates.push({
          lat: (previous.lat + current.lat) / 2,
          lng: (previous.lng + current.lng) / 2,
          startMs: previous.timestampMs,
          endMs: current.timestampMs,
          durationMs: elapsed,
          inferredFromGap: true,
          intervalCount: 1,
        });
      continue;
    }
    if (speedKmh >= 5) {
      finishSlow();
      continue;
    }
    const lat = (previous.lat + current.lat) / 2;
    const lng = (previous.lng + current.lng) / 2;
    if (slow) {
      slow.lat =
        (slow.lat * slow.durationMs + lat * elapsed) /
        (slow.durationMs + elapsed);
      slow.lng =
        (slow.lng * slow.durationMs + lng * elapsed) /
        (slow.durationMs + elapsed);
      slow.durationMs += elapsed;
      slow.endMs = current.timestampMs;
      slow.intervalCount++;
    } else
      slow = {
        lat,
        lng,
        startMs: previous.timestampMs,
        endMs: current.timestampMs,
        durationMs: elapsed,
        inferredFromGap: false,
        intervalCount: 1,
      };
  }
  finishSlow();

  const merged: Candidate[] = [];
  for (const candidate of candidates) {
    const previous = merged.at(-1);
    if (
      previous &&
      candidate.startMs >= previous.endMs &&
      candidate.startMs - previous.endMs <= MERGE_TIME_MS &&
      haversine(previous, candidate) <= MERGE_DISTANCE_M
    ) {
      const total = previous.durationMs + candidate.durationMs;
      previous.lat =
        (previous.lat * previous.durationMs +
          candidate.lat * candidate.durationMs) /
        total;
      previous.lng =
        (previous.lng * previous.durationMs +
          candidate.lng * candidate.durationMs) /
        total;
      previous.durationMs = total;
      previous.endMs = candidate.endMs;
      previous.inferredFromGap ||= candidate.inferredFromGap;
      previous.intervalCount += candidate.intervalCount;
    } else merged.push({ ...candidate });
  }
  return merged.map((candidate, index) => ({
    id: `rest-${String(index + 1).padStart(3, "0")}`,
    lat: candidate.lat,
    lng: candidate.lng,
    durationMinutes: Math.round(candidate.durationMs / 6000) / 10,
    inferredFromGap: candidate.inferredFromGap,
    intervalCount: candidate.intervalCount,
  }));
}
