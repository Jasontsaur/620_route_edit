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
  type RouteData,
} from "../lib/route";
import { exportGpx, exportTcx, exportFit, importFile } from "../lib/files";
Object.assign(globalThis, { DOMParser });
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
