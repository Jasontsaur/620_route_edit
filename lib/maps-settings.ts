export function canManageMaps(
  request: Request,
  token: unknown,
  expiresAt: unknown,
  now = Date.now(),
) {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return false;
  if (
    typeof expiresAt !== "string" ||
    !Number.isFinite(Number(expiresAt)) ||
    Number(expiresAt) <= now
  )
    return false;
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return false;
  const supplied =
    request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (supplied.length !== token.length) return false;
  let difference = 0;
  for (let i = 0; i < token.length; i++)
    difference |= token.charCodeAt(i) ^ supplied.charCodeAt(i);
  return difference === 0;
}

export function validBrowserMapsKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^AIza[A-Za-z0-9_-]{20,100}$/.test(value.trim())
  );
}
