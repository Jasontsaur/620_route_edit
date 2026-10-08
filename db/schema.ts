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
