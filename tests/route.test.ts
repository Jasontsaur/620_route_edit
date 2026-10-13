import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DOMParser } from "@xmldom/xmldom";
import { Decoder, Stream, Encoder, Profile } from "@garmin/fitsdk";
import {
  distance,
  haversine,
  routeMilestones,
  groups,
  simplify,
  validateRoute,
  orderedWaypoints,
  addImportedRoute,
  builtInRoute,
  type RouteData,
} from "../lib/route";
import { exportGpx, exportTcx, exportFit, importFile } from "../lib/files";
import {
  buildElevationProfile,
  kilometerTicks,
  elevationLayers,
  visibleMileageRange,
  mileageRangeTicks,
} from "../lib/elevation";
import { versionOwner } from "../lib/version-owner";
import {
  thinTrack,
  compactImportedRoute,
  type ImportSummary,
} from "../lib/compact-import";
Object.assign(globalThis, { DOMParser });

test("anonymous version storage creates independent browser identities without login", () => {
  const a = versionOwner(new Request("https://example.test/api/versions"));
  const b = versionOwner(new Request("https://example.test/api/versions"));
  assert.match(a.owner, /^anon:[a-f0-9]{64}$/);
  assert.notEqual(a.owner, b.owner);
  assert.match(a.headers["Set-Cookie"], /HttpOnly; SameSite=Lax; Secure$/);
  assert.equal(a.headers["Cache-Control"], "no-store");
});
test("anonymous version cookie persists ownership and cannot select an account namespace", () => {
  const first = versionOwner(new Request("https://example.test/api/versions"));
  const cookie = first.headers["Set-Cookie"].split(";")[0];
  const next = versionOwner(
    new Request("https://example.test/api/versions", {
      headers: { cookie: "other=x; " + cookie },
    }),
  );
  assert.equal(next.owner, first.owner);
  for (const value of [
    "user-id",
    "anon:invalid",
    "%61".repeat(64),
    "a".repeat(63),
    "a".repeat(65),
  ]) {
    const context = versionOwner(
      new Request("https://example.test/api/versions", {
        headers: { cookie: "route_editor_visitor=" + value },
      }),
    );
    assert.match(context.owner, /^anon:[a-f0-9]{64}$/);
    assert.notEqual(context.owner, value);
  }
});
test("previous signed-in versions remain scoped to optional trusted Sites identity", () => {
  const anonymous = versionOwner(
    new Request("https://example.test/api/versions"),
  );
  const request = new Request("https://example.test/api/versions", {
    headers: { cookie: anonymous.headers["Set-Cookie"].split(";")[0] },
  });
  const existing = versionOwner(request, "previous-account-id");
  assert.equal(existing.owner, "previous-account-id");
  assert.equal(existing.headers["Set-Cookie"], undefined);
  assert.notEqual(versionOwner(request).owner, existing.owner);
});
test("local anonymous version storage works on HTTP while hosted cookies are secure", () => {
  const context = versionOwner(
    new Request("http://127.0.0.1:8787/api/versions"),
  );
  assert.match(context.headers["Set-Cookie"], /HttpOnly; SameSite=Lax$/);
  assert.match(context.headers["Set-Cookie"], /Path=\/; Max-Age=31536000/);
});

test("viewport mileage includes segments crossing the map with both endpoints outside", () => {
  const route: RouteData = {
    name: "crossing",
    waypoints: [],
    provenance: "test",
    points: [
      { lat: 0, lng: 0, ele: 0 },
      { lat: 0, lng: 1, ele: 100 },
    ],
  };
  const profile = buildElevationProfile(route);
  const range = visibleMileageRange(profile, {
    south: -0.1,
    north: 0.1,
    west: 0.2,
    east: 0.8,
  })!;
  assert.ok(Math.abs(range.start - profile.meters * 0.2) < 0.01);
  assert.ok(Math.abs(range.end - profile.meters * 0.8) < 0.01);
  const tighter = visibleMileageRange(profile, {
    south: -0.1,
    north: 0.1,
    west: 0.4,
    east: 0.6,
  })!;
  assert.ok(tighter.start > range.start && tighter.end < range.end);
  assert.deepEqual(visibleMileageRange(profile, null), {
    start: 0,
    end: profile.meters,
  });
  assert.equal(
    visibleMileageRange(profile, { south: 2, north: 3, west: 2, east: 3 }),
    null,
  );
  assert.deepEqual(
    mileageRangeTicks({ start: 120000, end: 180000 }),
    [120000, 150000, 180000],
  );
  assert.deepEqual(
    mileageRangeTicks({ start: 51000, end: 52000 }),
    [51000, 52000],
  );
  assert.deepEqual(mileageRangeTicks({ start: 0, end: 0 }), [0]);
});
test("viewport preserves geographic alignment for a shifted and reversed visible track", () => {
  const base = [
    { lat: 0, lng: 0, ele: 0 },
    { lat: 0, lng: 1, ele: 100 },
  ];
  const input: RouteData = {
    name: "later reversed",
    waypoints: [],
    provenance: "test",
    points: [
      { lat: 0.005, lng: 0.8, ele: 80 },
      { lat: 0.005, lng: 0.4, ele: 40 },
    ],
    overlays: [{ id: "base", name: "base", points: base }],
  };
  const profile = buildElevationProfile(input);
  const range = visibleMileageRange(profile, {
    south: 0.004,
    north: 0.006,
    west: 0.5,
    east: 0.7,
  })!;
  assert.ok(Math.abs(range.start - profile.meters * 0.5) < 0.1);
  assert.ok(Math.abs(range.end - profile.meters * 0.7) < 0.1);
  assert.ok(range.start > 50000);
  const own = buildElevationProfile(input, "active");
  const ownRange = visibleMileageRange(own, {
    south: 0.004,
    north: 0.006,
    west: 0.5,
    east: 0.7,
  })!;
  assert.ok(Math.abs(ownRange.start - own.meters * 0.25) < 0.1);
  assert.ok(Math.abs(ownRange.end - own.meters * 0.75) < 0.1);
});
test("viewport never includes GPS gaps and uses min/max across separated visible portions", () => {
  const profile = buildElevationProfile({
    name: "gap",
    waypoints: [],
    provenance: "test",
    points: [
      { lat: 0, lng: 0, ele: 0 },
      { lat: 0, lng: 0.1, ele: 10 },
      { lat: 0, lng: 1, segment: 1, ele: 20 },
      { lat: 0, lng: 1.1, segment: 1, ele: 30 },
    ],
  });
  assert.equal(
    visibleMileageRange(profile, {
      south: -0.1,
      north: 0.1,
      west: 0.4,
      east: 0.6,
    }),
    null,
  );
  assert.deepEqual(
    visibleMileageRange(profile, {
      south: -0.1,
      north: 0.1,
      west: -0.1,
      east: 1.2,
    }),
    { start: 0, end: profile.meters },
  );
  const noHeights = buildElevationProfile({
    name: "no heights",
    waypoints: [],
    provenance: "test",
    points: [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 1 },
    ],
  });
  assert.ok(
    visibleMileageRange(noHeights, {
      south: -0.1,
      north: 0.1,
      west: 0.4,
      east: 0.6,
    })!.start > 0,
  );
});
test("viewport longitude clipping handles date-line views and whole-world bounds", () => {
  const profile = buildElevationProfile({
    name: "date line",
    waypoints: [],
    provenance: "test",
    points: [
      { lat: 0, lng: 179, ele: 0 },
      { lat: 0, lng: -179, ele: 100 },
    ],
  });
  const range = visibleMileageRange(profile, {
    south: -1,
    north: 1,
    west: 179.5,
    east: -179.5,
  })!;
  assert.ok(Math.abs(range.start - profile.meters * 0.25) < 0.01);
  assert.ok(Math.abs(range.end - profile.meters * 0.75) < 0.01);
  assert.deepEqual(
    visibleMileageRange(profile, {
      south: -90,
      north: 90,
      west: -180,
      east: 180,
    }),
    { start: 0, end: profile.meters },
  );
});

test("map milestones follow distance around bends and interpolate between samples", () => {
  const points = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 0.6 },
    { lat: 0.6, lng: 0.6 },
  ];
  const saved = structuredClone(points),
    markers = routeMilestones(points);
  assert.deepEqual(
    markers.map((p) => p.meters),
    [50000, 100000],
  );
  assert.ok(Math.abs(markers[0].lat) < 1e-8);
  assert.ok(Math.abs(haversine(points[0], markers[0]) - 50000) < 0.01);
  assert.ok(Math.abs(markers[1].lng - 0.6) < 1e-8);
  assert.ok(
    Math.abs(
      haversine(points[0], points[1]) +
        haversine(points[1], markers[1]) -
        100000,
    ) < 0.01,
  );
  assert.deepEqual(points, saved);
});
test("map milestones ignore GPS gaps, repeated samples and short routes", () => {
  const points = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 0 },
    { lat: 0, lng: 0.3 },
    { lat: 10, lng: 10, segment: 1 },
    { lat: 10.3, lng: 10, segment: 1 },
  ];
  const markers = routeMilestones(points);
  assert.equal(markers.length, 1);
  assert.ok(markers[0].lat > 10 && markers[0].lat < 10.3);
  assert.ok(
    Math.abs(
      haversine(points[1], points[2]) +
        haversine(points[3], markers[0]) -
        50000,
    ) < 0.01,
  );
  assert.deepEqual(routeMilestones(points.slice(0, 3)), []);
  assert.deepEqual(routeMilestones([]), []);
});
test("map milestones include exact 50 km endpoints once and cross the date line", () => {
  const lng = ((50000 / 6371000) * 180) / Math.PI;
  const points = [
    { lat: 0, lng: 0 },
    { lat: 0, lng },
    { lat: 0, lng },
  ];
  const markers = routeMilestones(points);
  assert.equal(markers.length, 1);
  assert.ok(haversine(markers[0], points[1]) < 0.01);
  const crossing = routeMilestones([
    { lat: 0, lng: 179.8 },
    { lat: 0, lng: -179.6 },
  ]);
  assert.equal(crossing.length, 1);
  assert.ok(crossing[0].lng < -179.6 && crossing[0].lng >= -180);
  assert.ok(
    Math.abs(haversine({ lat: 0, lng: 179.8 }, crossing[0]) - 50000) < 0.01,
  );
});

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

test("automatic thinning retains corners, hill extrema, endpoints and GPS/elevation gaps", () => {
  const points = Array.from({ length: 15001 }, (_, i) => ({
    lat: 25 + (i > 7500 ? (i - 7500) * 0.000001 : 0),
    lng: 121 + Math.min(i, 7500) * 0.000001,
    ele: i === 3000 ? 80 : i === 9000 ? -20 : 0,
    segment: i >= 12000 ? 1 : 0,
  }));
  points[6000].ele = undefined as unknown as number;
  const before = structuredClone(points);
  const kept = thinTrack(points, 2, 1);
  for (const i of [0, 3000, 5999, 6000, 6001, 7500, 9000, 11999, 12000, 15000])
    assert.ok(kept.includes(points[i]), "lost required index " + i);
  assert.equal(groups(kept).length, 2);
  assert.ok(kept.length < 1000);
  assert.deepEqual(points, before);
});
test("large track imports compact before validation and never hide invalid raw coordinates", () => {
  const points = Array.from({ length: 60001 }, (_, i) => ({
    lat: 25,
    lng: 121 + i * 0.000001,
    ele: 10,
  }));
  let summary: ImportSummary | undefined;
  const input = {
    name: "large",
    provenance: "test",
    waypoints: [],
    points,
    overlays: [{ id: "ref", name: "ref", points }],
  };
  const output = compactImportedRoute(input, (p) => {
    if (p.summary) summary = p.summary;
  });
  assert.ok(output.points.length < 12000);
  assert.ok(output.overlays![0].points.length < 12000);
  assert.equal(summary!.before, 120002);
  assert.equal(
    summary!.after,
    output.points.length + output.overlays![0].points.length,
  );
  assert.ok(Math.abs(summary!.beforeMeters - summary!.afterMeters) < 1);
  assert.equal(input.points.length, 60001);
  const bad = [...points];
  bad[12345] = { lat: 91, lng: 121, ele: 10 };
  assert.throws(
    () => compactImportedRoute({ ...input, points: bad }),
    /無效座標/,
  );
});
test("large GPX and TCX files auto-thin without deleting waypoints or joining tracks", async () => {
  const points = Array.from({ length: 51001 }, (_, i) => ({
    lat: 25,
    lng: 121 + i * 0.000001,
    ele: 10,
    segment: i > 25000 ? 1 : 0,
  }));
  const input = { ...route, points };
  for (const [name, data] of [
    ["large.gpx", exportGpx(input)],
    ["large.tcx", exportTcx(input)],
  ]) {
    let summary: ImportSummary | undefined;
    const output = await importFile(file(data, name), (p) => {
      if (p.summary) summary = p.summary;
    });
    assert.ok(output.points.length <= 12000);
    assert.equal(output.waypoints.length, 1);
    assert.equal(output.waypoints[0].name, route.waypoints[0].name);
    assert.equal(groups(output.points).length, 2);
    assert.equal(summary!.before, 51001);
  }
});
test("large JSON backups thin each layer while small backup imports are unchanged", async () => {
  const points = Array.from({ length: 51001 }, (_, i) => ({
    lat: 25,
    lng: 121 + i * 0.000001,
  }));
  const output = await importFile(
    file(
      JSON.stringify({
        ...route,
        points,
        overlays: [{ id: "ref", name: "ref", points }],
      }),
      "large.json",
    ),
  );
  assert.ok(output.points.length <= 12000);
  assert.ok(output.overlays![0].points.length <= 12000);
  assert.deepEqual(
    await importFile(file(JSON.stringify(route), "small.json")),
    route,
  );
});
test("XML extension data is ignored; large byte limits remain explicit", async () => {
  const data = exportGpx(route).replace(
    "</trkpt>",
    "<extensions><heartrate>99</heartrate></extensions></trkpt>",
  );
  checkGeometry(await importFile(file(data, "extensions.gpx")));
  const oversize = { size: 100000001, name: "too-large.gpx" } as File;
  await assert.rejects(importFile(oversize), /100MB/);
});

test("large FIT activity imports auto-thin while preserving an interrupted GPS segment", async () => {
  const encoder = new Encoder();
  const write = (n: number, m: Record<string, unknown>) =>
    encoder.onMesg(n, m as import("@garmin/fitsdk").Mesg);
  write(Profile.MesgNum.FILE_ID, {
    type: "activity",
    manufacturer: "development",
  });
  const semi = (n: number) => Math.round((n * 2 ** 31) / 180);
  for (let i = 0; i < 51001; i++)
    write(
      Profile.MesgNum.RECORD,
      i === 25000
        ? { heartRate: 80 }
        : {
            positionLat: semi(25),
            positionLong: semi(121 + i * 0.000001),
            altitude: 10,
            heartRate: 80,
            power: 100,
          },
    );
  let summary: ImportSummary | undefined;
  const output = await importFile(file(encoder.close(), "large.fit"), (p) => {
    if (p.summary) summary = p.summary;
  });
  assert.equal(summary!.before, 51000);
  assert.ok(output.points.length <= 12000);
  assert.equal(groups(output.points).length, 2);
  assert.ok(
    Math.abs(
      distance(output.points) -
        distance(
          Array.from({ length: 51001 }, (_, i) => ({
            lat: 25,
            lng: 121 + i * 0.000001,
          })),
        ),
    ) < 2,
  );
});

test("streamed XML validates namespaces and well-formedness across byte chunks", async () => {
  const prefixed = exportGpx(route)
    .replace("<gpx ", '<gpx xmlns:p="http://www.topografix.com/GPX/1/1" ')
    .replace(/<(\/?)(trk|trkseg|trkpt|ele)(?=[\s>])/g, "<$1p:$2");
  checkGeometry(await importFile(file(prefixed, "namespace.gpx")));
  await assert.rejects(
    importFile(
      file(
        '<gpx><trk><trkseg><trkpt lat="25" lon="121"></trkseg></gpx>',
        "bad.gpx",
      ),
    ),
    /XML/,
  );
  await assert.rejects(
    importFile(
      file(
        exportGpx({
          ...route,
          waypoints: Array.from({ length: 501 }, (_, i) => ({
            ...route.waypoints[0],
            id: String(i),
          })),
        }),
        "points.gpx",
      ),
    ),
    /500/,
  );
});

test("built-in composition combines two differently colored routes and official checkpoints", async () => {
  const official = JSON.parse(
    await readFile("public/data/twb-2026.json", "utf8"),
  );
  const ride = {
    name: "Synthetic public test",
    provenance: "test only",
    points: official.points.slice(0, 3),
    waypoints: [],
  };
  const initial = builtInRoute(official, ride);
  assert.equal(initial.points.length, 3);
  assert.equal(initial.name, ride.name);
  assert.equal(initial.overlays?.length, 1);
  assert.equal(initial.overlays![0].points.length, 2658);
  assert.equal(initial.overlays![0].name, official.name);
  assert.equal(initial.waypoints.length, 8);
  const layers = elevationLayers(initial);
  assert.equal(layers.length, 2);
  assert.notEqual(layers[0].color, layers[1].color);
  assert.equal(
    buildElevationProfile(initial).reference.id,
    "overlay:twb-2026-default",
  );
  assert.deepEqual(validateRoute(JSON.parse(JSON.stringify(initial))), initial);
  assert.equal(ride.waypoints.length, 0);
});

test("published built-in ride has 3892 points and both defaults fit a saved version", async () => {
  const official = JSON.parse(
    await readFile("public/data/twb-2026.json", "utf8"),
  );
  const ride = validateRoute(
    JSON.parse(await readFile("public/data/520-activity-slim.json", "utf8")),
  );
  const initial = builtInRoute(official, ride);
  assert.equal(initial.name, "520 騎乘紀錄（瘦身）");
  assert.equal(initial.points.length, 3892);
  assert.equal(initial.overlays?.length, 1);
  assert.equal(initial.overlays![0].points.length, 2658);
  assert.equal(initial.waypoints.length, 8);
  assert.ok(
    distance(initial.points) > 516000 && distance(initial.points) < 517000,
  );
  assert.ok(distance(initial.overlays![0].points) > 600000);
  assert.equal(groups(initial.points).length, 1);
  assert.ok(initial.points.every((p) => p.ele !== undefined));
  assert.ok(
    Buffer.byteLength(JSON.stringify({ route: initial, note: "default" })) <
      1800000,
  );
  assert.equal(buildElevationProfile(initial).profiles.length, 2);
});

test("shared Maps settings reject public writes, incorrect origins, invalid and expired capabilities", async () => {
  const { canManageMaps } = await import("../lib/maps-settings");
  const token = "a".repeat(64),
    expires = "2000";
  const request = (origin: string, authorization: string) =>
    new Request("https://example.com/api/maps-config", {
      method: "POST",
      headers: { origin, authorization },
    });
  assert.equal(
    canManageMaps(
      request("https://example.com", "Bearer " + token),
      token,
      expires,
      1000,
    ),
    true,
  );
  for (const [origin, supplied] of [
    ["", token],
    ["https://evil.example", token],
    ["https://example.com", "b".repeat(64)],
    ["https://example.com", ""],
  ])
    assert.equal(
      canManageMaps(
        request(origin, "Bearer " + supplied),
        token,
        expires,
        1000,
      ),
      false,
    );
  assert.equal(
    canManageMaps(
      request("https://example.com", "Bearer " + token),
      undefined,
      expires,
      1000,
    ),
    false,
  );
  assert.equal(
    canManageMaps(
      request("https://example.com", "Bearer " + token),
      token,
      "invalid",
      1000,
    ),
    false,
  );
  assert.equal(
    canManageMaps(
      request("https://example.com", "Bearer " + token),
      token,
      expires,
      2000,
    ),
    false,
  );
});

test("Maps settings accept browser keys while rejecting script and whitespace injection", async () => {
  const { validBrowserMapsKey } = await import("../lib/maps-settings");
  assert.equal(validBrowserMapsKey("  AIza" + "x".repeat(35) + "  "), true);
  for (const key of [
    null,
    {},
    "",
    "AIza<script>alert(1)</script>",
    "AIza" + "x".repeat(101),
    "AIza" + "x".repeat(25) + "\nother",
  ])
    assert.equal(validBrowserMapsKey(key), false);
});

test("all displayed positions use the immutable TWB origin after shifted imports, overlay deletion and backup restore", async () => {
  const { referenceWaypoints, mileageSpan } = await import("../lib/mileage");
  const { cumulative } = await import("../lib/route");
  const official = validateRoute(
    JSON.parse(await readFile("public/data/twb-2026.json", "utf8")),
  );
  const ds = cumulative(official.points);
  const reference = { name: official.name, points: official.points };
  const waypoints = [
    {
      ...official.points[600],
      id: "later",
      name: "Later",
      kind: "custom" as const,
      note: "",
    },
    {
      ...official.points[0],
      id: "start",
      name: "Start",
      kind: "custom" as const,
      note: "",
    },
    {
      ...official.points[300],
      id: "earlier",
      name: "Earlier",
      kind: "custom" as const,
      note: "",
    },
    {
      lat: 40,
      lng: 140,
      id: "far",
      name: "Far",
      kind: "custom" as const,
      note: "",
    },
  ];
  const shifted = {
    name: "Shifted",
    provenance: "test",
    points: official.points.slice(300, 601),
    waypoints,
  };
  const imported = addImportedRoute(builtInRoute(official, shifted), {
    ...shifted,
    name: "Imported",
  });
  const deleted = { ...imported, overlays: [] };
  const restored = addImportedRoute(imported, shifted, true);
  for (const route of [shifted, imported, deleted, restored]) {
    const profile = buildElevationProfile(route, "active", reference);
    assert.equal(profile.reference.name, official.name);
    assert.equal(profile.reference.points, reference.points);
    const active = profile.profiles.find((p) => p.id === "active")!;
    assert.ok(Math.abs(active.paths[0][0].meters - ds[300]) < 1);
    assert.ok(active.paths[0][0].meters > 0);
    const allStations = referenceWaypoints(route, reference);
    const stations = allStations.filter((p) =>
      ["start", "earlier", "later"].includes(p.waypoint.id),
    );
    assert.deepEqual(
      stations.map((p) => p.waypoint.id),
      ["start", "earlier", "later"],
    );
    assert.equal(stations[0].meters, 0);
    assert.ok(Math.abs(stations[1].meters! - ds[300]) < 1);
    assert.ok(allStations.find((p) => p.waypoint.id === "far")!.offset! > 1000);
    for (let i = 1; i < allStations.length; i++)
      assert.ok(allStations[i].meters! >= allStations[i - 1].meters!);
    const range = mileageSpan(route.points, reference)!;
    assert.ok(Math.abs(range.start - ds[300]) < 1);
    assert.ok(Math.abs(range.end - ds[600]) < 1);
  }
  assert.deepEqual(
    waypoints.map((w) => w.id),
    ["later", "start", "earlier", "far"],
  );
});

test("reversed tracks, viewport and 50km map markers retain the fixed origin without modifying route length", async () => {
  const { mileageSpan } = await import("../lib/mileage");
  const { cumulative } = await import("../lib/route");
  const reference = {
    name: "TWB 2026 四極點620",
    points: [
      { lat: 23, lng: 120, ele: 5 },
      { lat: 23, lng: 120.5, ele: 10 },
      { lat: 23, lng: 121, ele: 20 },
      { lat: 23, lng: 121.5, ele: 30 },
    ],
  };
  const route = {
    name: "Reverse",
    provenance: "test",
    points: [...reference.points.slice(1)].reverse(),
    waypoints: [],
  };
  const original = JSON.stringify(route);
  const ds = cumulative(reference.points);
  const profile = buildElevationProfile(route, undefined, reference);
  const active = profile.profiles[0];
  assert.ok(Math.abs(active.paths[0][0].meters - ds[3]) < 1);
  assert.ok(Math.abs(active.paths[0].at(-1)!.meters - ds[1]) < 1);
  const range = visibleMileageRange(profile, {
    south: 22.99,
    north: 23.01,
    west: 120.49,
    east: 121.01,
  })!;
  assert.ok(range.start > 45000 && range.end > 100000);
  const span = mileageSpan(route.points, reference)!;
  assert.ok(Math.abs(span.start - ds[1]) < 1);
  const labels = routeMilestones(reference.points);
  assert.deepEqual(
    labels.map((p) => p.meters),
    [50000, 100000, 150000],
  );
  assert.ok(
    labels[0].lng > reference.points[0].lng &&
      labels[0].lng < reference.points[1].lng,
  );
  assert.equal(JSON.stringify(route), original);
  assert.ok(distance(route.points) < distance(reference.points));
});
