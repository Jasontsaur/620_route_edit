const sessionCookie = "route_shared_session";
const editorCookie = "route_shared_editor";
const validToken = (s: unknown): s is string =>
  typeof s === "string" && /^[a-f0-9]{64}$/.test(s);
export const sameOrigin = (request: Request) =>
  request.headers.get("origin") === new URL(request.url).origin;
export function equalToken(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function cookie(request: Request, name: string) {
  return (
    request.headers
      .get("cookie")
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(name + "="))
      ?.slice(name.length + 1) ?? ""
  );
}
export async function digest(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export function editorCookieValue(request: Request, token: string) {
  return `${editorCookie}=${token}; Path=/api/shared-route; Max-Age=31536000; HttpOnly; SameSite=Strict${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}
export async function sharedAccess(
  request: Request,
  key: unknown,
  publicEdit: unknown,
) {
  const saved = cookie(request, sessionCookie);
  const token = validToken(saved)
    ? saved
    : Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
  const headers = new Headers({
    "Cache-Control": "no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
  });
  if (!validToken(saved))
    headers.set(
      "Set-Cookie",
      `${sessionCookie}=${token}; Path=/api/shared-route; Max-Age=31536000; HttpOnly; SameSite=Strict${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`,
    );
  const csrf = await digest("620-shared-route:" + token);
  const isEditor =
    validToken(key) && equalToken(cookie(request, editorCookie), key);
  const canEdit = publicEdit === "true" || isEditor;
  return {
    headers,
    csrf,
    canEdit,
    isEditor,
    publicEdit: publicEdit === "true",
    mayWrite:
      canEdit &&
      validToken(saved) &&
      sameOrigin(request) &&
      equalToken(request.headers.get("x-route-csrf") ?? "", csrf),
  };
}
export function acceptsEditorKey(request: Request, key: unknown) {
  return (
    validToken(key) &&
    sameOrigin(request) &&
    equalToken(
      request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "",
      key,
    )
  );
}
