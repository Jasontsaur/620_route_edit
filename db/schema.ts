import { sqliteTable, text, real, index } from "drizzle-orm/sqlite-core";
export const versions = sqliteTable(
  "route_versions",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    note: text("note").notNull(),
    created: text("created").notNull(),
    parent: text("parent"),
    distance: real("distance").notNull(),
    payload: text("payload").notNull(),
  },
  (table) => [index("versions_owner_created").on(table.owner, table.created)],
);

export const mapSettings = sqliteTable("map_settings", {
  id: text("id").primaryKey(),
  apiKey: text("api_key").notNull(),
  updated: text("updated").notNull(),
});

export const sharedRoute = sqliteTable("shared_route_state", {
  id: text("id").primaryKey(),
  revision: text("revision").notNull(),
  updated: text("updated").notNull(),
  versionId: text("version_id"),
  operationHash: text("operation_hash").notNull(),
  payload: text("payload").notNull(),
});
