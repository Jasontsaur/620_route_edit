import { env } from "cloudflare:workers";
import { getRawDb } from "../../../db";
import { canManageMaps, validBrowserMapsKey } from "../../../lib/maps-settings";

const headers = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers });

// Only the browser Maps key is public; the management capability is never returned.
export async function GET() {
  try {
    const row = await getRawDb()
      .prepare("SELECT api_key FROM map_settings WHERE id = ?")
      .bind("google-maps")
      .first<{ api_key: string }>();
    const apiKey =
      row?.api_key ??
      (typeof env.GOOGLE_MAPS_API_KEY === "string"
        ? env.GOOGLE_MAPS_API_KEY.trim()
        : "");
    return json({ apiKey, configured: Boolean(apiKey) });
  } catch {
    return json({ error: "後端地圖設定暫時無法讀取，請稍後重試。" }, 503);
  }
}

export async function POST(request: Request) {
  if (!canManageMaps(request, env.MAPS_SETUP_TOKEN, env.MAPS_SETUP_EXPIRES_AT))
    return json(
      { error: "管理設定連結無效或已過期；請由網站擁有者重新開啟。" },
      403,
    );
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return json({ error: "設定格式錯誤。" }, 415);
  try {
    const reader = request.body?.getReader();
    if (!reader) return json({ error: "缺少金鑰。" }, 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) {
        await reader.cancel();
        return json({ error: "設定內容過大。" }, 413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const body = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || !validBrowserMapsKey(body.apiKey))
      return json({ error: "請輸入有效的 Google Maps API 金鑰。" }, 400);
    await getRawDb()
      .prepare(
        "INSERT INTO map_settings (id, api_key, updated) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET api_key = excluded.api_key, updated = excluded.updated",
      )
      .bind("google-maps", body.apiKey.trim(), new Date().toISOString())
      .run();
    return json({ saved: true });
  } catch {
    return json({ error: "金鑰儲存失敗；請檢查輸入內容或稍後再試。" }, 400);
  }
}
