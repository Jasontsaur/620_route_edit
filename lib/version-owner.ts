// Anonymous browser capability for version storage; it never selects account-owned records.
const cookieName = "route_editor_visitor";
export function versionOwner(request: Request, signedInOwner?: string) {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  // Existing Sites identity is optional, solely to retain access to previously saved versions.
  if (signedInOwner) return { owner: signedInOwner, headers };
  const saved = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(cookieName + "="))
    ?.slice(cookieName.length + 1);
  const token =
    saved && /^[a-f0-9]{64}$/.test(saved)
      ? saved
      : Array.from(crypto.getRandomValues(new Uint8Array(32)), (n) =>
          n.toString(16).padStart(2, "0"),
        ).join("");
  headers["Set-Cookie"] =
    `${cookieName}=${token}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
  return { owner: "anon:" + token, headers };
}
