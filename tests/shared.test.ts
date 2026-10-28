import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import {
  acceptsEditorKey,
  editorCookieValue,
  sharedAccess,
} from "../lib/shared-access";
import {
  readShared,
  saveShared,
  sharedResponse,
  sharedOwner,
  SharedConflict,
  validateSharedSave,
} from "../lib/shared-store";
import { SharedRouteClient, CloudSaveError } from "../lib/shared-client";
import type { RouteData } from "../lib/route";

const origin = "https://example.test";
const key = "ac".repeat(32);
const route: RouteData = {
  name: "測試騎乘",
  provenance: "使用者匯入",
  points: [
    {
      lat: 25,
      lng: 121,
      ele: 10,
      recordedTime: "07:30:00",
      recordedSpeedKmh: 26.5,
      speedSource: "device",
      recordedPower10sW: 0,
    },
    {
      lat: 24.99,
      lng: 121.01,
      ele: 15,
      recordedTime: "07:32:10",
      recordedPower10sW: 201.3,
    },
  ],
  waypoints: [
    { id: "a", name: "補水", lat: 25, lng: 121, kind: "water", note: "自訂" },
  ],
  overlays: [
    {
      id: "ref",
      name: "四極點620",
      points: [
        { lat: 25, lng: 121 },
        { lat: 24, lng: 120 },
      ],
    },
  ],
};
const input = (
  revision: string | null,
  action: "import" | "autosave" | "snapshot" | "restore" = "import",
  r = route,
) =>
  validateSharedSave({
    revision,
    action,
    route: r,
    operationId: crypto.randomUUID(),
    note: "測試",
  });

// Exercise the actual generated SQLite schema and SQL, including atomic batches.
async function database() {
  const sql = new DatabaseSync(":memory:");
  for (const migration of [
    "0000_optimal_black_tom.sql",
    "0001_overconfident_cable.sql",
    "0002_known_jamie_braddock.sql",
  ])
    sql.exec(await readFile("drizzle/" + migration, "utf8"));
  function statement(query: string, values: unknown[] = []): unknown {
    return {
      bind: (...v: unknown[]) => statement(query, v),
      first: async () =>
        sql.prepare(query).get(...(values as (string | number | null)[])) ??
        null,
      all: async () => ({
        results: sql
          .prepare(query)
          .all(...(values as (string | number | null)[])),
      }),
      run: async () => ({
        meta: {
          changes: Number(
            sql.prepare(query).run(...(values as (string | number | null)[]))
              .changes,
          ),
        },
      }),
    };
  }
  const db = {
    prepare: statement,
    batch: async (items: { run: () => Promise<unknown> }[]) => {
      sql.exec("BEGIN");
      try {
        const result = [];
        for (const item of items) result.push(await item.run());
        sql.exec("COMMIT");
        return result;
      } catch (e) {
        sql.exec("ROLLBACK");
        throw e;
      }
    },
  } as unknown as D1Database;
  return { db, sql };
}

test("shared read is global and independent of browser identity; all layers and metrics persist", async () => {
  const { db, sql } = await database();
  assert.equal(await readShared(db), null);
  const op = input(null);
  const saved = await saveShared(db, op);
  assert.deepEqual(sharedResponse(await readShared(db)).route, route);
  assert.equal(saved.revision, op.operationId);
  assert.equal(
    sql.prepare("SELECT owner FROM route_versions").get()?.owner,
    sharedOwner,
  );
  sql.close();
});
test("autosave updates current state without changing historical snapshots; restore makes a new snapshot", async () => {
  const { db, sql } = await database();
  const first = await saveShared(db, input(null));
  const next = { ...route, name: "修改後", overlays: [] };
  const second = await saveShared(db, input(first.revision, "autosave", next));
  assert.equal(second.version_id, first.version_id);
  assert.equal(
    sql.prepare("SELECT COUNT(*) n FROM route_versions").get()?.n,
    1,
  );
  const old = sql
    .prepare("SELECT payload FROM route_versions WHERE id=?")
    .get(first.version_id!)?.payload as string;
  assert.equal(JSON.parse(old).name, route.name);
  const restored = await saveShared(db, input(second.revision, "restore"));
  assert.notEqual(restored.version_id, first.version_id);
  assert.equal(
    sql
      .prepare("SELECT parent FROM route_versions WHERE id=?")
      .get(restored.version_id!)?.parent,
    first.version_id,
  );
  assert.equal(
    sql
      .prepare("SELECT payload FROM route_versions WHERE id=?")
      .get(first.version_id!)?.payload,
    old,
  );
  sql.close();
});
test("lost-response retries are idempotent and cannot create duplicate import snapshots", async () => {
  const { db, sql } = await database();
  const op = input(null);
  const first = await saveShared(db, op);
  assert.deepEqual(await saveShared(db, op), first);
  assert.equal(
    sql.prepare("SELECT COUNT(*) n FROM route_versions").get()?.n,
    1,
  );
  await assert.rejects(
    saveShared(db, { ...op, route: { ...route, name: "不同內容" } }),
    SharedConflict,
  );
  sql.close();
});
test("stale tabs and competing first saves fail safely without extra versions", async () => {
  const { db, sql } = await database();
  const first = await saveShared(db, input(null));
  await assert.rejects(saveShared(db, input(null)), SharedConflict);
  const changed = await saveShared(
    db,
    input(first.revision, "snapshot", { ...route, name: "另一裝置" }),
  );
  await assert.rejects(saveShared(db, input(first.revision)), SharedConflict);
  assert.equal((await readShared(db))?.revision, changed.revision);
  assert.equal(
    sql.prepare("SELECT COUNT(*) n FROM route_versions").get()?.n,
    2,
  );
  sql.close();
});
test("private historical versions are excluded from public shared history", async () => {
  const { db, sql } = await database();
  sql
    .prepare("INSERT INTO route_versions VALUES(?,?,?,?,?,?,?,?)")
    .run(
      "private",
      "anon:old",
      "私人",
      "",
      "2026",
      null,
      0,
      JSON.stringify(route),
    );
  await saveShared(db, input(null));
  assert.equal(
    sql
      .prepare("SELECT COUNT(*) n FROM route_versions WHERE owner=?")
      .get(sharedOwner)?.n,
    1,
  );
  assert.equal(
    sql
      .prepare("SELECT payload FROM route_versions WHERE id=? AND owner=?")
      .get("private", sharedOwner),
    undefined,
  );
  sql.close();
});
test("write access requires an editing link, existing session, same origin and CSRF; public reads disclose no editing key", async () => {
  const first = await sharedAccess(
    new Request(origin + "/api/shared-route"),
    key,
    undefined,
  );
  assert.equal(first.canEdit, false);
  assert.equal(first.mayWrite, false);
  const session = first.headers.get("set-cookie")!.split(";")[0];
  assert.match(
    first.headers.get("set-cookie")!,
    /HttpOnly; SameSite=Strict; Secure$/,
  );
  const editor = editorCookieValue(new Request(origin), key).split(";")[0];
  const request = (extra: Record<string, string> = {}) =>
    new Request(origin + "/api/shared-route", {
      method: "POST",
      headers: {
        cookie: `${session}; ${editor}`,
        origin,
        "x-route-csrf": first.csrf,
        ...extra,
      },
    });
  assert.equal((await sharedAccess(request(), key, undefined)).mayWrite, true);
  assert.equal(
    (
      await sharedAccess(
        request({ origin: "https://attacker.test" }),
        key,
        undefined,
      )
    ).mayWrite,
    false,
  );
  assert.equal(
    (await sharedAccess(request({ "x-route-csrf": "bad" }), key, undefined))
      .mayWrite,
    false,
  );
  assert.equal(
    (await sharedAccess(request({ cookie: session }), key, undefined)).mayWrite,
    false,
  );
  assert.equal(
    (await sharedAccess(request({ cookie: editor }), key, undefined)).mayWrite,
    false,
  );
  assert.equal(
    (await sharedAccess(request({ cookie: session }), key, "true")).mayWrite,
    true,
  );
  assert.equal(
    acceptsEditorKey(
      new Request(origin, {
        method: "POST",
        headers: { origin, Authorization: "Bearer " + key },
      }),
      key,
    ),
    true,
  );
  assert.equal(
    acceptsEditorKey(
      new Request(origin, { headers: { Authorization: "Bearer " + key } }),
      key,
    ),
    false,
  );
});
test("default browser fetch keeps its global receiver for load, access and saving", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async function (this: unknown, url, init) {
    // Window.fetch rejects a class instance as its receiver in browsers.
    if (this !== globalThis) throw new TypeError("Illegal invocation");
    calls.push(String(url));
    if (String(url).endsWith("/access")) return Response.json({ ok: true });
    if (init?.method === "POST")
      return Response.json({
        revision: JSON.parse(String(init.body)).operationId,
        updated: "2026-10-28T00:00:00Z",
        versionId: "v",
      });
    return Response.json({
      route,
      revision: null,
      updated: null,
      versionId: null,
      csrf: "csrf",
      canEdit: true,
      publicEdit: true,
    });
  };
  try {
    const client = new SharedRouteClient();
    const loaded = await client.load("editor-link");
    assert.equal(loaded.canEdit, true);
    assert.equal(loaded.publicEdit, true);
    assert.deepEqual(loaded.route, route);
    await client.save(route, "import");
    assert.equal(client.pending, null);
    assert.deepEqual(calls, [
      "/api/shared-route/access",
      "/api/shared-route",
      "/api/shared-route",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("client first load only reads, retry resends identical failed operation before newer edits", async () => {
  const bodies: string[] = [];
  let loseResponse = true;
  const fetcher = async (_url: unknown, init?: RequestInit) => {
    if (init?.method !== "POST")
      return Response.json({
        route,
        revision: null,
        updated: null,
        versionId: null,
        csrf: "csrf",
        canEdit: true,
        publicEdit: false,
      });
    const body = String(init.body);
    bodies.push(body);
    assert.equal(
      (init.headers as Record<string, string>)["X-Route-CSRF"],
      "csrf",
    );
    if (loseResponse) {
      loseResponse = false;
      throw Error("response lost");
    }
    return Response.json({
      revision: JSON.parse(body).operationId,
      updated: "2026-10-28T00:00:00Z",
      versionId: "v",
    });
  };
  const client = new SharedRouteClient(fetcher as typeof fetch);
  assert.deepEqual((await client.load()).route, route);
  assert.equal(bodies.length, 0);
  await assert.rejects(client.save(route, "import"));
  assert.equal(client.pending?.route, route);
  const newer = { ...route, name: "new" };
  const ack = await client.save(newer, "autosave");
  assert.equal(bodies[0], bodies[1]);
  assert.equal(client.pending, null);
  await client.save(newer, "autosave");
  assert.equal(JSON.parse(bodies[2]).revision, ack.revision);
  assert.equal(JSON.parse(bodies[2]).route.name, "new");
});
test("client retains unsaved content and base revision on conflict", async () => {
  const initial = crypto.randomUUID();
  const client = new SharedRouteClient((async (_url, init) =>
    init?.method === "POST"
      ? Response.json({ error: "衝突" }, { status: 409 })
      : Response.json({
          route: null,
          revision: initial,
          csrf: "s",
          canEdit: true,
        })) as typeof fetch);
  await client.load();
  await assert.rejects(
    client.save(route, "snapshot"),
    (e: unknown) => e instanceof CloudSaveError && e.status === 409,
  );
  assert.equal(client.revision, initial);
  assert.equal(client.pending?.route, route);
});
test("invalid shared actions and malformed routes are rejected", () => {
  assert.throws(() => validateSharedSave({ ...input(null), operationId: "x" }));
  assert.throws(() =>
    validateSharedSave({ ...input(null), route: { ...route, points: [] } }),
  );
  assert.throws(() => validateSharedSave({ ...input(null), action: "delete" }));
  assert.throws(() =>
    validateSharedSave({ ...input(null), note: "x".repeat(2001) }),
  );
});
