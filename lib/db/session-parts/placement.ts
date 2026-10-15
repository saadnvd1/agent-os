import type Database from "better-sqlite3";
import type { PartPatch } from "./columns";
import { writePart, type When } from "./write";

// Where a task came from and who holds it: mirror, holder, starting device.
export const setPlacement = (
  db: Database.Database,
  sessionId: string,
  patch: PartPatch<"session_placement">,
  when?: When<"session_placement">
): boolean => writePart(db, "session_placement", sessionId, patch, when);
