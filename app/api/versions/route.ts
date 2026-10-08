import { getRawDb } from "../../../db";
import { getChatGPTUser } from "../../chatgpt-auth";
import { distance, validateRoute } from "../../../lib/route";
async function owner() {
  return (await getChatGPTUser())?.userId;
}
export async function GET(request: Request) {
  const user = await owner();
  if (!user)
    return Response.json({ error: "請登入後存取雲端版本。" }, { status: 401 });
  try {
    const db = getRawDb();
    const id = new URL(request.url).searchParams.get("id");
    if (id) {
      const row = await db
        .prepare(
          "SELECT id, payload FROM route_versions WHERE id = ? AND owner = ?",
        )
        .bind(id, user)
        .first<{ id: string; payload: string }>();
      if (!row)
        return Response.json({ error: "找不到版本。" }, { status: 404 });
      return Response.json(
        { route: JSON.parse(row.payload), id: row.id },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const rows = await db
      .prepare(
        "SELECT id, name, note, created, parent, distance FROM route_versions WHERE owner = ? ORDER BY created DESC LIMIT 100",
      )
      .bind(user)
      .all();
    return Response.json(
      { versions: rows.results },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    console.error("Version read failed", e);
    return Response.json(
      { error: "雲端版本暫時無法讀取；目前編輯仍保留在頁面，請稍後重試。" },
      { status: 503 },
    );
  }
}
export async function POST(request: Request) {
  const user = await owner();
  if (!user)
    return Response.json({ error: "請登入後儲存版本。" }, { status: 401 });
  if (
    request.headers.get("origin") &&
    request.headers.get("origin") !== new URL(request.url).origin
  )
    return Response.json({ error: "來源不符。" }, { status: 403 });
  let body;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 1800000)
      return Response.json(
        { error: "版本超過 1.8MB；請先簡化軌跡後再儲存。" },
        { status: 413 },
      );
    body = JSON.parse(text);
    validateRoute(body.route);
    if (typeof body.note !== "string" || body.note.length > 2000)
      throw Error("版本備註不符格式。");
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "無效資料" },
      { status: 400 },
    );
  }
  try {
    const db = getRawDb(),
      id = crypto.randomUUID(),
      created = new Date().toISOString();
    await db
      .prepare(
        "INSERT INTO route_versions (id, owner, name, note, created, parent, distance, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        id,
        user,
        body.route.name,
        body.note,
        created,
        body.route.parentId ?? null,
        distance(body.route.points),
        JSON.stringify(body.route),
      )
      .run();
    return Response.json({ id, created }, { status: 201 });
  } catch (e) {
    console.error("Version save failed", e);
    return Response.json(
      { error: "版本未儲存成功；請保留頁面或下載備份，稍後重試。" },
      { status: 503 },
    );
  }
}
