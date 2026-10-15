import type Database from "better-sqlite3";
import type { PartPatch } from "./columns";
import { writePart, type When } from "./write";

// A task's timed pause.
export const setPause = (
  db: Database.Database,
  sessionId: string,
  patch: PartPatch<"session_pauses">,
  when?: When<"session_pauses">
): boolean => writePart(db, "session_pauses", sessionId, patch, when);
