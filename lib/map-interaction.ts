// One conventional wheel notch is 60 normalized pixels. Its new zoom change
// is half a level; trackpad deltas accumulate instead of jumping every event.
export function wheelPixels(deltaY: number, deltaMode: number) {
  if (!Number.isFinite(deltaY)) return 0;
  const pixels = deltaY * (deltaMode === 1 ? 20 : deltaMode === 2 ? 60 : 1);
  return Math.max(-60, Math.min(60, pixels));
}
export function addWheelPixels(pending: number, delta: number) {
  return pending && delta && Math.sign(pending) !== Math.sign(delta)
    ? delta
    : pending + delta;
}
export function wheelZoomBatch(
  pixels: number,
  zoom: number,
  min: number,
  max: number,
) {
  const steps = Math.trunc(pixels / 60);
  return {
    zoom: Math.max(min, Math.min(max, zoom - steps * 0.5)),
    remainder: pixels - steps * 60,
  };
}
// World-coordinate center after zooming, keeping the geographic position under
// the mouse at the same screen pixel. Google projections use a 256-pixel world.
export function zoomCenter(
  center: { x: number; y: number },
  offset: { x: number; y: number },
  before: number,
  after: number,
) {
  const factor = 2 ** -before - 2 ** -after;
  return { x: center.x + offset.x * factor, y: center.y + offset.y * factor };
}
