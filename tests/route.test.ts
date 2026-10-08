import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DOMParser } from "@xmldom/xmldom";
import { Decoder, Stream, Encoder, Profile } from "@garmin/fitsdk";
import {
  distance,
  groups,
  simplify,
  validateRoute,
  orderedWaypoints,
  addImportedRoute,
  type RouteData,
} from "../lib/route";
import { exportGpx, exportTcx, exportFit, importFile } from "../lib/files";
import { buildElevationProfile, kilometerTicks } from "../lib/elevation";
Object.assign(globalThis, { DOMParser });

test("elevation aligns shifted starts and reversed tracks by position, not their own mileage", () => {
  const points = Array.from({ length: 11 }, (_, i) => ({
    lat: 25,
    lng: 121 + i * 0.01,
    ele: i * 10,
  }));
  const input: RouteData = {
    name: "later start",
    points: points.slice(4).map((p) => ({ ...p, ele: p.ele + 5 })),
    waypoints: [],
    provenance: "test",
    overlays: [{ id: "base", name: "base", points }],
  };
  const profile = buildElevationProfile(input);
  const active = profile.profiles.find((l) => l.id === "active")!;
  const base = profile.profiles[0];
  assert.ok(active.paths[0][0].meters > 3900);
  assert.ok(
    Math.abs(active.paths[0][0].meters - base.paths[0][4].meters) < 0.01,
  );
  assert.equal(active.paths[0][0].elevation, 45);
  const reverse = buildElevationProfile({
    ...input,
    points: [...input.points].reverse(),
  }).profiles.at(-1)!;
  assert.ok(Math.abs(reverse.paths[0][0].meters - profile.meters) < 0.01);
  assert.ok(reverse.paths[0][0].meters > reverse.paths[0].at(-1)!.meters);
  assert.equal(buildElevationProfile(input, "active").reference.id, "active");
});
test("elevation uses segment projection and leaves missing heights, GPS gaps and distant routes unconnected", () => {
  const input: RouteData = {
    name: "midpoint",
    provenance: "test",
    waypoints: [],
    points: [
      { lat: 25, lng: 121.01, ele: 30 },
      { lat: 25, lng: 121.015 },
      { lat: 25, lng: 121.02, ele: 50 },
      { lat: 25, lng: 121.025, ele: 60, segment: 1 },
    ],
    overlays: [
      {
        id: "base",
        name: "base",
        points: [
          { lat: 25, lng: 121, ele: 0 },
          { lat: 25, lng: 121.03, ele: 10 },
        ],
      },
    ],
  };
  const profile = buildElevationProfile(input),
    active = profile.profiles.at(-1)!;
  assert.ok(Math.abs(active.paths[0][0].meters - profile.meters / 3) < 0.1);
  assert.equal(active.paths.length, 3);
  const far = buildElevationProfile({
    ...input,
    points: input.points.map((p) => ({ ...p, lat: 24 })),
  }).profiles.at(-1)!;
  assert.equal(far.paths.length, 0);
  assert.ok(far.unmatched > 0);
  const noHeight = buildElevationProfile({
    ...input,
    points: input.points.map(({ lat, lng }) => ({ lat, lng })),
  }).profiles.at(-1)!;
  assert.equal(noHeight.hasElevation, false);
  assert.deepEqual(
    kilometerTicks(620000),
    Array.from({ length: 13 }, (_, i) => i * 50000),
  );
  assert.deepEqual(kilometerTicks(0), [0]);
});
test("elevation projection never bridges disconnected reference segments", () => {
  const profile = buildElevationProfile({
    name: "gap midpoint",
    waypoints: [],
    provenance: "test",
    points: [
      { lat: 25, lng: 121.05, ele: 10 },
      { lat: 25, lng: 121.06, ele: 20 },
    ],
    overlays: [
      {
        id: "base",
        name: "base",
        points: [
          { lat: 25, lng: 121, ele: 0 },
          { lat: 25, lng: 121.01, ele: 0 },
          { lat: 25, lng: 121.1, ele: 0, segment: 1 },
          { lat: 25, lng: 121.11, ele: 0, segment: 1 },
        ],
      },
    ],
  });
  assert.equal(profile.profiles.at(-1)!.paths.length, 0);
});
test("simplification preserves endpoints, corners and segment gaps", () => {
  const points = [
    { lat: 25, lng: 121 },
    { lat: 25, lng: 121.00001 },
    { lat: 25, lng: 121.01 },
    { lat: 25.01, lng: 121.01 },
    { lat: 23, lng: 120, segment: 1 },
    { lat: 23, lng: 120.01, segment: 1 },
  ];
  const output = simplify(points, 4);
  assert.equal(output.length, 5);
  assert.deepEqual(output[0], points[0]);
  assert.deepEqual(output.at(-1), points.at(-1));
  assert.equal(groups(output).length, 2);
  assert.ok(output.includes(points[2]));
});
test("FIT activity GPS gaps remain separate instead of adding a cross-island straight line", async () => {
  const encoder = new Encoder();
  const write = (n: number, m: Record<string, unknown>) =>
    encoder.onMesg(n, m as import("@garmin/fitsdk").Mesg);
  write(Profile.MesgNum.FILE_ID, {
    type: "activity",
    manufacturer: "development",
  });
  const semicircle = (n: number) => Math.round((n * 2 ** 31) / 180);
  for (const [lat, lng] of [
    [25, 121],
    [24.99, 121],
    [NaN, NaN],
    [23, 120],
    [22.99, 120],
    [NaN, NaN],
    [21, 120],
  ])
    write(
      Profile.MesgNum.RECORD,
      Number.isFinite(lat)
        ? { positionLat: semicircle(lat), positionLong: semicircle(lng) }
        : { heartRate: 80 },
    );
  const output = await importFile(file(encoder.close(), "activity.fit"));
  assert.equal(groups(output.points).length, 3);
  assert.ok(distance(output.points) < 2300);
});
const route: RouteData = {
  name: "測試 & <海岸>",
  provenance: "測試幾何",
  points: [
    { lat: 25, lng: 121, ele: 5 },
    { lat: 24.99, lng: 120.99, ele: 12.4 },
    { lat: 24.98, lng: 120.98, ele: 8 },
  ],
  waypoints: [
    {
      id: "w1",
      name: "補水 & <休息>",
      kind: "water",
      note: '備註 & "引號"',
      lat: 24.99,
      lng: 120.99,
    },
  ],
};
const file = (text: string | Uint8Array, name: string) =>
  new File(
    [typeof text === "string" ? text : new Uint8Array(text).buffer],
    name,
  );
test("waypoints sort by current track mileage without mutating saved order", () => {
  const w = route.waypoints[0];
  const input = {
    ...route,
    waypoints: [
      { ...w, id: "end", ...route.points[2], officialKm: 0 },
      { ...w, id: "start", ...route.points[0], officialKm: 999 },
      { ...w, id: "middle", ...route.points[1] },
    ],
  };
  const sorted = orderedWaypoints(input);
  assert.deepEqual(
    sorted.map((v) => v.waypoint.id),
    ["start", "middle", "end"],
  );
  assert.ok(sorted[2].meters > sorted[1].meters);
  assert.equal(input.waypoints[0].id, "end");
});
test("successive imports retain reference tracks and points; JSON restores saved layers", async () => {
  const imported = {
    ...route,
    name: "新路線",
    points: route.points.map((p) => ({ ...p, lng: p.lng + 0.01 })),
    waypoints: [],
  };
  const first = addImportedRoute(route, imported);
  assert.deepEqual(first.points, imported.points);
  assert.deepEqual(first.overlays?.[0].points, route.points);
  assert.deepEqual(first.waypoints, route.waypoints);
  const second = addImportedRoute(first, { ...imported, name: "第三條" });
  assert.equal(second.overlays?.length, 2);
  const backup = await importFile(file(JSON.stringify(second), "layers.json"));
  assert.deepEqual(addImportedRoute(route, backup, true), second);
  assert.equal(route.overlays, undefined);
  assert.throws(() =>
    validateRoute({
      ...second,
      overlays: [{ id: "bad", name: "bad", points: [{ lat: NaN, lng: 121 }] }],
    }),
  );
  assert.throws(
    () =>
      addImportedRoute(
        {
          ...first,
          overlays: Array.from({ length: 8 }, (_, i) => ({
            id: String(i),
            name: "參考",
            points: route.points,
          })),
        },
        imported,
      ),
    /最多保留 8/,
  );
});
function checkGeometry(actual: RouteData) {
  assert.equal(actual.points.length, route.points.length);
  actual.points.forEach((p, i) => {
    assert.ok(Math.abs(p.lat - route.points[i].lat) < 1e-6);
    assert.ok(Math.abs(p.lng - route.points[i].lng) < 1e-6);
    assert.ok(Math.abs(p.ele! - route.points[i].ele!) < 0.21);
  });
  assert.equal(actual.waypoints.length, 1);
  assert.equal(actual.waypoints[0].name, route.waypoints[0].name);
}
test("GPX roundtrip preserves coordinates, elevation, escaped names and point notes", async () => {
  const result = await importFile(file(exportGpx(route), "test.gpx"));
  checkGeometry(result);
  assert.equal(result.name, route.name);
  assert.equal(result.waypoints[0].note, route.waypoints[0].note);
});
test("TCX course roundtrip preserves geometry and coursepoints", async () => {
  const result = await importFile(file(exportTcx(route), "test.tcx"));
  checkGeometry(result);
  assert.equal(result.waypoints[0].note, route.waypoints[0].note);
});
test("FIT export has valid CRC, course file type, exact record count, distance and cues", async () => {
  const data = await exportFit(route);
  const decoder = new Decoder(
    Stream.fromArrayBuffer(new Uint8Array(data).buffer),
  );
  assert.ok(decoder.isFIT());
  assert.ok(decoder.checkIntegrity());
  const { messages, errors } = decoder.read();
  assert.deepEqual(errors, []);
  assert.equal(messages.fileIdMesgs?.[0].type, "course");
  assert.equal(messages.recordMesgs?.length, 3);
  assert.equal(messages.coursePointMesgs?.length, 1);
  assert.equal(messages.coursePointMesgs?.[0].type, "water");
  assert.ok(
    Math.abs(
      Number(messages.lapMesgs?.[0].totalDistance) - distance(route.points),
    ) < 0.02,
  );
  checkGeometry(await importFile(file(data, "test.fit")));
});
test("FIT import refuses damaged file", async () => {
  const data = new Uint8Array(await exportFit(route));
  data[20] ^= 255;
  await assert.rejects(importFile(file(data, "bad.fit")), /CRC/);
});
test("segmented GPX never counts missing track gaps; FIT refuses bridging", async () => {
  const segmented = {
    ...route,
    points: [
      ...route.points,
      { lat: 23, lng: 120, segment: 1 },
      { lat: 22.99, lng: 120, segment: 1 },
    ],
  };
  const result = await importFile(file(exportGpx(segmented), "seg.gpx"));
  assert.equal(groups(result.points).length, 2);
  assert.ok(
    Math.abs(distance(result.points) - distance(segmented.points)) < 0.001,
  );
  assert.ok(distance(result.points) < 5000);
  await assert.rejects(exportFit(segmented), /分段/);
});
test("invalid coordinates and empty GPS imports fail instead of drawing bogus tracks", async () => {
  assert.throws(() =>
    validateRoute({
      ...route,
      points: [
        { lat: 91, lng: 1 },
        { lat: 1, lng: 1 },
      ],
    }),
  );
  await assert.rejects(
    importFile(
      file(
        '<gpx><trk><trkseg><trkpt lat="x" lon="1"/></trkseg></trk></gpx>',
        "bad.gpx",
      ),
    ),
  );
  await assert.rejects(
    importFile(
      file(
        "<TrainingCenterDatabase><Activities><Activity><Lap><Track><Trackpoint><Time>2026-01-01</Time></Trackpoint></Track></Lap></Activity></Activities></TrainingCenterDatabase>",
        "no-gps.tcx",
      ),
    ),
  );
});
test("official baseline is valid, has 8 checkpoints and honest measured length", async () => {
  const data = validateRoute(
    JSON.parse(await readFile("public/data/twb-2026.json", "utf8")),
  );
  assert.equal(data.points.length, 2658);
  assert.ok(distance(data.points) > 600000 && distance(data.points) < 605000);
  const { checkpointSeed } = await import("../lib/route");
  assert.equal(checkpointSeed.length, 8);
  assert.equal(checkpointSeed.at(-1)!.officialKm, 615);
});
