import { getRawDb } from "../../../../db";
import { sharedOwner } from "../../../../lib/shared-store";
const headers = { "Cache-Control": "no-store, max-age=0" };
export async function GET(request: Request) {
  const json = (data: unknown, status = 200) =>
    Response.json(data, { status, headers });
  try {
    const db = getRawDb();
    const id = new URL(request.url).searchParams.get("id");
    if (id) {
      const row = await db
        .prepare(
          "SELECT id, payload FROM route_versions WHERE id = ? AND owner = ?",
        )
        .bind(id, sharedOwner)
        .first<{ id: string; payload: string }>();
      return row
        ? json({ id: row.id, route: JSON.parse(row.payload) })
        : json({ error: "找不到共用版本。" }, 404);
    }
    const rows = await db
      .prepare(
        "SELECT id, name, note, created, parent, distance FROM route_versions WHERE owner = ? ORDER BY created DESC LIMIT 100",
      )
      .bind(sharedOwner)
      .all();
    return json({ versions: rows.results });
  } catch {
    return json({ error: "共用版本暫時無法讀取。" }, 503);
  }
}
