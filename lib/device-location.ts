export type DeviceFix = {
  lat: number;
  lng: number;
  accuracy: number;
  timestamp: number;
};
export type LocationState = {
  status: "off" | "requesting" | "active" | "error";
  fix: DeviceFix | null;
  message: string;
};
export const locationOff: LocationState = {
  status: "off",
  fix: null,
  message: "",
};
export function deviceFix(position: GeolocationPosition): DeviceFix | null {
  const { latitude: lat, longitude: lng, accuracy } = position.coords;
  if (
    ![lat, lng, accuracy, position.timestamp].every(Number.isFinite) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180 ||
    accuracy < 0 ||
    position.timestamp < 0
  )
    return null;
  return { lat, lng, accuracy, timestamp: position.timestamp };
}
export function locationError(code: number) {
  if (code === 1)
    return "定位權限未開放。請在瀏覽器與系統設定允許此網站使用位置；若為內嵌頁面，請用 Safari 或 Chrome 直接開啟網站。";
  if (code === 3)
    return "定位逾時。請確認系統定位已開啟，移到訊號較好的地方，再按「我的位置」重試。";
  return "暫時無法取得位置。請確認系統定位與網路已開啟，再按「我的位置」重試。";
}
// Position data stays in this page's memory, separate from shared route payloads.
export class DeviceLocationTracker {
  private watch: number | null = null;
  private generation = 0;
  private running = false;
  private latestTimestamp = -1;
  constructor(
    private geo: Pick<Geolocation, "watchPosition" | "clearWatch">,
    private changed: (state: LocationState) => void,
  ) {}
  start() {
    if (this.running) return;
    const generation = ++this.generation;
    this.running = true;
    this.latestTimestamp = -1;
    this.changed({
      status: "requesting",
      fix: null,
      message: "正在取得位置，請允許瀏覽器定位…",
    });
    const fail = (code: number) => {
      if (!this.running || this.generation !== generation) return;
      this.halt();
      this.changed({
        status: "error",
        fix: null,
        message: locationError(code),
      });
    };
    try {
      // Keep the native Geolocation receiver, just as with native Window.fetch.
      const id = this.geo.watchPosition(
        (position) => {
          if (!this.running || this.generation !== generation) return;
          const fix = deviceFix(position);
          if (!fix) {
            fail(2);
            return;
          }
          if (fix.timestamp < this.latestTimestamp) return;
          this.latestTimestamp = fix.timestamp;
          this.changed({ status: "active", fix, message: "" });
        },
        (error) => fail(error.code),
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
      );
      // Some test/embedded providers invoke a callback before returning an ID.
      if (this.running && this.generation === generation) this.watch = id;
      else this.geo.clearWatch(id);
    } catch (error) {
      fail(
        error instanceof DOMException && error.name === "SecurityError" ? 1 : 2,
      );
    }
  }
  private halt() {
    this.running = false;
    this.generation++;
    const id = this.watch;
    this.watch = null;
    if (id !== null) this.geo.clearWatch(id);
  }
  stop() {
    this.halt();
    this.changed(locationOff);
  }
  dispose() {
    this.halt();
  }
}
