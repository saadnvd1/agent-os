/**
 * Undoes migration 81: schedules that became recipes get their old kind
 * (task or session) and brief back, and the recipes the move made are
 * removed with their runs. Stop AgentOS first; it reads the database too.
 *
 *   npx tsx scripts/revert-schedules-move.ts --db <path to agent-os.db>
 *
 * Migration 81 stays recorded as applied, so a restart won't redo the move.
 */

import Database from "better-sqlite3";
import { revertSchedulesMove } from "../lib/db/schedules-move";

const args = process.argv.slice(2);
const dbPath = args[args.indexOf("--db") + 1];
if (!args.includes("--db") || !dbPath || dbPath.startsWith("--")) {
  console.error("usage: revert-schedules-move.ts --db <path>");
  process.exit(2);
}

const db = new Database(dbPath, { fileMustExist: true, timeout: 10000 });
const { schedules } = revertSchedulesMove(db);
console.log(`Restored ${schedules} schedule(s) to their old kind.`);
db.close();
