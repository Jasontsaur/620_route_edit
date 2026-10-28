import { distance, validateRoute, type RouteData } from "./route";
import { digest } from "./shared-access";

export const sharedOwner = "shared:site";
export type SaveAction = "autosave" | "import" | "snapshot" | "restore";
export type SharedSave = {
  route: RouteData;
  revision: string | null;
  operationId: string;
  action: SaveAction;
  note: string;
};
export type SharedRow = {
  revision: string;
  updated: string;
  version_id: string | null;
  operation_hash: string;
  payload: string;
};
export class SharedConflict extends Error {}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function validateSharedSave(value: unknown): SharedSave {
  if (!value || typeof value !== "object") throw Error("無效的路線資料。");
  const b = value as SharedSave;
  if (
    !uuid.test(b.operationId) ||
    !(
      b.revision === null ||
      (typeof b.revision === "string" && uuid.test(b.revision))
    ) ||
    b.revision === b.operationId
  )
    throw Error("儲存識別資料無效，請重新載入。");
  if (
    !["autosave", "import", "snapshot", "restore"].includes(b.action) ||
    typeof b.note !== "string" ||
    b.note.length > 2000
  )
    throw Error("儲存動作或備註無效。");
  return { ...b, route: validateRoute(b.route) };
}
export async function readShared(db: D1Database) {
  return db
    .prepare(
      "SELECT revision, updated, version_id, operation_hash, payload FROM shared_route_state WHERE id = ?",
    )
    .bind("current")
    .first<SharedRow>();
}
export function sharedResponse(row: SharedRow | null) {
  return {
    route: row ? JSON.parse(row.payload) : null,
    revision: row?.revision ?? null,
    updated: row?.updated ?? null,
    versionId: row?.version_id ?? null,
  };
}
export async function saveShared(db: D1Database, input: SharedSave) {
  const payload = JSON.stringify(input.route);
  if (new TextEncoder().encode(payload).length > 1_800_000)
    throw Error("路線超過 1.8MB；請簡化軌跡或移除不需要的參考圖層。");
  const operationHash = await digest(
    JSON.stringify([payload, input.action, input.note]),
  );
  const previous = await readShared(db);
  // A lost response can be retried without duplicating an import or snapshot.
  if (
    previous?.revision === input.operationId &&
    previous.operation_hash === operationHash
  )
    return previous;
  if ((previous?.revision ?? null) !== input.revision)
    throw new SharedConflict();
  const updated = new Date().toISOString();
  const versionId =
    input.action === "autosave"
      ? (previous?.version_id ?? null)
      : crypto.randomUUID();
  const change =
    input.revision === null
      ? db
          .prepare(
            "INSERT OR IGNORE INTO shared_route_state (id, revision, updated, version_id, operation_hash, payload) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .bind(
            "current",
            input.operationId,
            updated,
            versionId,
            operationHash,
            payload,
          )
      : db
          .prepare(
            "UPDATE shared_route_state SET revision = ?, updated = ?, version_id = ?, operation_hash = ?, payload = ? WHERE id = ? AND revision = ?",
          )
          .bind(
            input.operationId,
            updated,
            versionId,
            operationHash,
            payload,
            "current",
            input.revision,
          );
  const statements = [change];
  if (input.action !== "autosave") {
    const note =
      input.note ||
      {
        import: "匯入路線時自動保留",
        snapshot: "手動儲存版本",
        restore: "回復歷史版本",
      }[input.action];
    statements.push(
      db
        .prepare(
          "INSERT INTO route_versions (id, owner, name, note, created, parent, distance, payload) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM shared_route_state WHERE id = ? AND revision = ? AND version_id = ?)",
        )
        .bind(
          versionId,
          sharedOwner,
          input.route.name,
          note,
          updated,
          previous?.version_id ?? null,
          distance(input.route.points),
          payload,
          "current",
          input.operationId,
          versionId,
        ),
    );
  }
  // Both compare-and-swap and snapshot creation commit together in D1.
  await db.batch(statements);
  const saved = await readShared(db);
  if (
    saved?.revision !== input.operationId ||
    saved.operation_hash !== operationHash
  )
    throw new SharedConflict();
  return saved;
}
