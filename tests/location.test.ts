import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DeviceLocationTracker,
  deviceFix,
  locationOff,
  type LocationState,
} from "../lib/device-location";

const sample = (lat = 25.03, lng = 121.56, accuracy = 12, timestamp = 1000) =>
  ({
    coords: {
      latitude: lat,
      longitude: lng,
      accuracy,
      altitude: 500,
      heading: 123,
      speed: 30,
    },
    timestamp,
  }) as GeolocationPosition;
function provider() {
  const listeners: {
    success: PositionCallback;
    failure: PositionErrorCallback | null | undefined;
  }[] = [];
  const cleared: number[] = [];
  const options: PositionOptions[] = [];
  const geo = {
    watchPosition(
      success: PositionCallback,
      failure?: PositionErrorCallback | null,
      settings?: PositionOptions,
    ) {
      assert.equal(
        this,
        geo,
        "Geolocation.watchPosition must keep its native receiver",
      );
      options.push(settings!);
      listeners.push({ success, failure });
      return listeners.length - 1;
    },
    clearWatch(id: number) {
      assert.equal(this, geo);
      cleared.push(id);
    },
  };
  const changes: LocationState[] = [];
  const tracker = new DeviceLocationTracker(geo, (state) =>
    changes.push(state),
  );
  return { tracker, changes, listeners, cleared, options };
}
test("location is opt-in, requests fresh high accuracy fixes and preserves native API receivers", () => {
  const p = provider();
  assert.equal(p.listeners.length, 0);
  assert.equal(p.changes.length, 0);
  p.tracker.start();
  p.tracker.start();
  assert.equal(p.listeners.length, 1);
  assert.equal(p.changes[0].status, "requesting");
  assert.deepEqual(p.options[0], {
    enableHighAccuracy: true,
    maximumAge: 5000,
    timeout: 15000,
  });
  p.listeners[0].success(sample());
  assert.deepEqual(p.changes.at(-1)?.fix, {
    lat: 25.03,
    lng: 121.56,
    accuracy: 12,
    timestamp: 1000,
  });
  p.listeners[0].success(sample(25.04, 121.57, 8, 2000));
  p.listeners[0].success(sample(25, 121, 100, 1500));
  assert.equal(p.changes.at(-1)?.fix?.lat, 25.04);
});
test("stop clears watch ID zero, removes the fix and ignores delayed callbacks", () => {
  const p = provider();
  p.tracker.start();
  p.listeners[0].success(sample());
  p.tracker.stop();
  assert.deepEqual(p.cleared, [0]);
  assert.deepEqual(p.changes.at(-1), locationOff);
  const count = p.changes.length;
  p.listeners[0].success(sample());
  p.listeners[0].failure?.({ code: 1 } as GeolocationPositionError);
  assert.equal(p.changes.length, count);
});
test("permission denial, unavailable location and timeouts stop watching and allow retry", () => {
  for (const code of [1, 2, 3]) {
    const p = provider();
    p.tracker.start();
    p.listeners[0].success(sample());
    p.listeners[0].failure?.({ code } as GeolocationPositionError);
    assert.equal(p.changes.at(-1)?.status, "error");
    assert.equal(p.changes.at(-1)?.fix, null);
    assert.match(
      p.changes.at(-1)!.message,
      code === 1 ? /權限/ : code === 3 ? /逾時/ : /無法/,
    );
    assert.deepEqual(p.cleared, [0]);
    p.tracker.start();
    const count = p.changes.length;
    p.listeners[0].success(sample());
    assert.equal(p.changes.length, count);
    p.listeners[1].success(sample(24, 120));
    assert.equal(p.changes.at(-1)?.fix?.lat, 24);
    p.tracker.dispose();
    assert.deepEqual(p.cleared, [0, 1]);
  }
});
test("unmount cleanup is silent and rejects callbacks after disposal", () => {
  const p = provider();
  p.tracker.start();
  const count = p.changes.length;
  p.tracker.dispose();
  p.tracker.dispose();
  p.listeners[0].success(sample());
  assert.equal(p.changes.length, count);
  assert.deepEqual(p.cleared, [0]);
});
test("synchronous permission errors still clear the watch returned afterwards", () => {
  const cleared: number[] = [],
    changes: LocationState[] = [];
  const geo = {
    watchPosition(_s: PositionCallback, error?: PositionErrorCallback | null) {
      error?.({ code: 1 } as GeolocationPositionError);
      return 7;
    },
    clearWatch(id: number) {
      cleared.push(id);
    },
  };
  const tracker = new DeviceLocationTracker(geo, (s) => changes.push(s));
  tracker.start();
  assert.deepEqual(cleared, [7]);
  assert.equal(changes.at(-1)?.status, "error");
});
test("embedded browser security failures become readable permission errors", () => {
  const changes: LocationState[] = [];
  const tracker = new DeviceLocationTracker(
    {
      watchPosition() {
        throw new DOMException("blocked", "SecurityError");
      },
      clearWatch() {},
    },
    (s) => changes.push(s),
  );
  tracker.start();
  assert.equal(changes.at(-1)?.status, "error");
  assert.match(changes.at(-1)!.message, /Safari/);
});
test("invalid coordinates are never shown and sensor metadata is excluded from location state", () => {
  assert.deepEqual(deviceFix(sample(0, 0, 0, 0)), {
    lat: 0,
    lng: 0,
    accuracy: 0,
    timestamp: 0,
  });
  for (const position of [
    sample(NaN),
    sample(91),
    sample(0, 181),
    sample(0, 0, -1),
    sample(0, 0, Infinity),
    sample(0, 0, 1, -1),
  ])
    assert.equal(deviceFix(position), null);
  const p = provider();
  p.tracker.start();
  p.listeners[0].success(sample(NaN));
  assert.equal(p.changes.at(-1)?.fix, null);
  assert.equal(p.changes.at(-1)?.status, "error");
  assert.deepEqual(p.cleared, [0]);
});
