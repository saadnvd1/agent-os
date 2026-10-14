import type { Migration } from "../migration-types";

export default {
  id: 8,
  name: "add_dev_server_columns",
  up: (db) => {
    db.exec(
      `ALTER TABLE dev_servers ADD COLUMN type TEXT NOT NULL DEFAULT 'node'`
    );
    db.exec(`ALTER TABLE dev_servers ADD COLUMN name TEXT NOT NULL DEFAULT ''`);
    db.exec(
      `ALTER TABLE dev_servers ADD COLUMN command TEXT NOT NULL DEFAULT ''`
    );
    db.exec(`ALTER TABLE dev_servers ADD COLUMN pid INTEGER`);
    db.exec(
      `ALTER TABLE dev_servers ADD COLUMN working_directory TEXT NOT NULL DEFAULT ''`
    );
  },
} satisfies Migration;
