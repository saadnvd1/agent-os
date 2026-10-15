import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PART_COLUMNS } from "./columns";

const ROOT = join(__dirname, "../../..");
const MOVED = Object.values(PART_COLUMNS).flat() as string[];
const MOVED_RE = new RegExp(`\\b(${MOVED.join("|")})\\b`);

// The moved columns are gone from sessions (migration 20261015T1830). Only
// migrations, and tests that build a database as it was before them, name
// them on sessions.
const SKIP =
  /^lib\/db\/(migrations|session-parts)\/|^lib\/db\/[\w-]*migrations?\.test\.ts$|^lib\/db\/schedules-move\.test\.ts$/;

// Statements the scan reads as touching moved columns on sessions that do not.
const ALLOWED: Record<string, string> = {
  "lib/db/schedules-move.ts":
    "runs inside migration 81, against a sessions table older than the split",
};

const LITERAL = /`(?:[^`\\]|\\.)*`|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g;
const TOUCHES_SESSIONS =
  /\b(UPDATE(\s+OR\s+\w+)?|INSERT(\s+OR\s+\w+)?\s+INTO|FROM|JOIN)\s+sessions\b(?!_)(?<!DELETE\s+FROM\s+sessions)/i;
const STAR = /\bSELECT\s+(DISTINCT\s+)?(\w+\.)?\*|\b\w+\.\*/i;

function violations(): string[] {
  const files = execFileSync(
    "git",
    ["ls-files", "*.ts", "*.tsx", "*.js", "*.mjs", "*.sh"],
    {
      cwd: ROOT,
      encoding: "utf8",
    }
  )
    .split("\n")
    .filter((f) => f && !SKIP.test(f) && !(f in ALLOWED));
  const found: string[] = [];
  for (const file of files) {
    const src = readFileSync(join(ROOT, file), "utf8");
    for (const m of src.matchAll(LITERAL)) {
      // What a statement reads through the view is fine wherever it sits.
      const sql = m[0].replace(
        /\(\s*SELECT[^()]*\bFROM\s+session_rows\b[^()]*\)/gi,
        "()"
      );
      if (!TOUCHES_SESSIONS.test(sql)) continue;
      const column = MOVED_RE.exec(sql)?.[1];
      const star = /\bFROM\s+sessions\b|\bJOIN\s+sessions\b/i.test(sql)
        ? STAR.test(sql)
        : false;
      if (!column && !star) continue;
      const line = src.slice(0, m.index).split("\n").length;
      found.push(
        `${file}:${line} ${column ? `uses ${column}` : "selects *"} on sessions`
      );
    }
  }
  return found;
}

describe("moved columns are only touched through lib/db/session-parts", () => {
  it("has no SQL on sessions that names a moved column or selects *", () => {
    expect(
      violations(),
      "Read moved columns from session_rows and write them with setTask, setPr, setPlan, setPlacement or setPause (lib/db/session-parts)."
    ).toEqual([]);
  });
});
