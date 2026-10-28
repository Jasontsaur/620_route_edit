import { env } from "cloudflare:workers";
import { getRawDb } from "../../../db";
import { sharedAccess } from "../../../lib/shared-access";
import {
  readShared,
  saveShared,
  sharedResponse,
  SharedConflict,
  validateSharedSave,
} from "../../../lib/shared-store";

export async function GET(request: Request) {
  const access = await sharedAccess(
    request,
    env.SHARED_ROUTE_EDIT_KEY,
    env.SHARED_ROUTE_PUBLIC_EDIT,
  );
  try {
    return Response.json(
      {
        ...sharedResponse(await readShared(getRawDb())),
        csrf: access.csrf,
        canEdit: access.canEdit,
        publicEdit: access.publicEdit,
      },
      { headers: access.headers },
    );
  } catch {
    return Response.json(
      { error: "共用路線暫時無法讀取，請稍後重試。" },
      { status: 503, headers: access.headers },
    );
  }
}
export async function POST(request: Request) {
  const access = await sharedAccess(
    request,
    env.SHARED_ROUTE_EDIT_KEY,
    env.SHARED_ROUTE_PUBLIC_EDIT,
  );
  const json = (data: unknown, status = 200) =>
    Response.json(data, { status, headers: access.headers });
  if (!access.mayWrite)
    return json({ error: "請透過私人編輯連結開啟此頁面後再更新路線。" }, 403);
  let body;
  try {
    const reader = request.body?.getReader();
    if (!reader) throw Error("沒有路線資料。");
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1_850_000) {
        await reader.cancel();
        return json(
          {
            error:
              "路線超過 1.8MB，請簡化軌跡或移除不需要的參考圖層；目前修改仍在頁面中。",
          },
          413,
        );
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    body = validateSharedSave(JSON.parse(new TextDecoder().decode(bytes)));
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : "無效路線資料。" },
      400,
    );
  }
  try {
    const saved = await saveShared(getRawDb(), body);
    return json({
      revision: saved.revision,
      updated: saved.updated,
      versionId: saved.version_id,
    });
  } catch (e) {
    if (e instanceof SharedConflict)
      return json(
        {
          error:
            "另一個頁面已更新共用路線。請先匯出目前內容備份，再載入最新共用路線。",
        },
        409,
      );
    console.error("Shared route save failed", e);
    return json(
      {
        error:
          e instanceof Error && e.message.includes("1.8MB")
            ? e.message
            : "自動儲存未成功；請保留頁面或下載 JSON 備份，再按重試。",
      },
      503,
    );
  }
}
