import { env } from "cloudflare:workers";
import {
  acceptsEditorKey,
  editorCookieValue,
  sharedAccess,
} from "../../../../lib/shared-access";
const headers = { "Cache-Control": "no-store, max-age=0" };
export async function POST(request: Request) {
  if (!acceptsEditorKey(request, env.SHARED_ROUTE_EDIT_KEY))
    return Response.json(
      { error: "私人編輯連結無效或已更換。" },
      { status: 403, headers },
    );
  return Response.json(
    { ok: true },
    {
      headers: {
        ...headers,
        "Set-Cookie": editorCookieValue(
          request,
          env.SHARED_ROUTE_EDIT_KEY as string,
        ),
      },
    },
  );
}
// Only an already authorized editor can explicitly copy their editing link.
export async function GET(request: Request) {
  const access = await sharedAccess(
    request,
    env.SHARED_ROUTE_EDIT_KEY,
    env.SHARED_ROUTE_PUBLIC_EDIT,
  );
  if (!access.isEditor || request.headers.get("x-route-csrf") !== access.csrf)
    return Response.json({ error: "沒有編輯權限。" }, { status: 403, headers });
  return Response.json({ token: env.SHARED_ROUTE_EDIT_KEY }, { headers });
}
