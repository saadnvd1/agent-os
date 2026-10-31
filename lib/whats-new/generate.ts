import fs from "fs";
import path from "path";
import { areaFor, collectCommits, type Git } from "./collect";
import { lintEntry } from "./lint";
import { fileSchema, type Entry } from "./schema";
import { authorLine, fillGaps, type Ask, type Line } from "./summarize";
import { WHATS_NEW_FILE } from "./load";

export interface PrInfo {
  body: string;
  url: string;
}

export interface GenerateDeps {
  git: Git;
  /** Bodies and links of merged PRs; throws when it can't ask, so nothing is guessed. */
  prs: (numbers: number[]) => Map<number, PrInfo>;
  ask: Ask;
  blocklist: string[];
}

export interface GenerateResult {
  added: Entry[];
  /** Merges that had a line but couldn't ship, with the reason. */
  dropped: { pr: number; reason: string }[];
  skipped: number;
  head: string;
}

// `raw` is what is written back for existing entries, so a field the schema
// doesn't know about survives a run too.
export function readFile(root: string): { entries: Entry[]; raw: unknown[] } {
  try {
    const json = JSON.parse(
      fs.readFileSync(path.join(root, WHATS_NEW_FILE), "utf-8")
    );
    return { entries: fileSchema.parse(json).entries, raw: json.entries };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      return { entries: [], raw: [] };
    throw e;
  }
}

/**
 * New entries for merges since `through` (or the last `sinceDays`). Append
 * only: an id already in the file is never read, changed or reordered, so a
 * hand edit or "hidden" survives. Writes the file only when there is
 * something to add.
 */
export async function generate(
  root: string,
  opts: { through?: string | null; sinceDays: number; write: boolean },
  deps: GenerateDeps
): Promise<GenerateResult> {
  const { entries, raw } = readFile(root);
  const head = deps.git(["rev-parse", "HEAD"]).trim();
  const commits = collectCommits(
    deps.git,
    opts,
    new Set(entries.map((e) => e.id)),
    WHATS_NEW_FILE
  );
  const result: GenerateResult = { added: [], dropped: [], skipped: 0, head };
  if (!commits.length) return result;

  const prs = deps.prs(commits.map((c) => c.pr));
  const lines = new Map<number, Line>();
  const gaps = [];
  for (const c of commits) {
    const line = authorLine(prs.get(c.pr)?.body);
    if (line) lines.set(c.pr, line);
    else gaps.push({ n: c.pr, type: c.type, title: c.title });
  }
  if (gaps.length)
    for (const [n, line] of await fillGaps(gaps, deps.ask)) lines.set(n, line);

  for (const c of commits) {
    const line = lines.get(c.pr);
    if (!line || "skip" in line) {
      result.skipped++;
      continue;
    }
    const entry: Entry = {
      id: c.pr,
      date: c.date,
      kind: line.kind,
      area: areaFor(c),
      text: line.text,
      ...(prs.get(c.pr)?.url && { url: prs.get(c.pr)!.url }),
    };
    const bad = lintEntry(entry, deps.blocklist);
    if (bad) result.dropped.push({ pr: c.pr, reason: bad });
    else result.added.push(entry);
  }

  if (opts.write && result.added.length) {
    const file = path.join(root, WHATS_NEW_FILE);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({ v: 1, entries: [...raw, ...result.added] }, null, 2) +
        "\n"
    );
  }
  return result;
}
