import type {
  Analysis,
  Criterion,
  CommandResult,
  CriterionStatus,
  Evidence,
} from "./types";

export interface Resolver {
  // The run's checks all passed.
  green: boolean;
  commands: CommandResult[];
  // Changed lines per file on the branch: [start, end] ranges in the new file.
  hunks: Map<string, [number, number][]>;
  ci: { name: string; state: string; sha?: string | null }[];
  snapshotSha: string;
}

// "@@ -a,b +c,d @@" per file, from `git diff -U0`.
export function parseHunks(diff: string): Map<string, [number, number][]> {
  const out = new Map<string, [number, number][]>();
  let file: string | null = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      file = line.startsWith("+++ b/") ? line.slice(6) : null;
      if (file && !out.has(file)) out.set(file, []);
    } else if (file && line.startsWith("@@")) {
      const m = /\+(\d+)(?:,(\d+))?/.exec(line);
      if (m) {
        const start = Number(m[1]);
        const len = m[2] === undefined ? 1 : Number(m[2]);
        out.get(file)!.push([start, start + Math.max(len, 1) - 1]);
      }
    }
  }
  return out;
}

const lower = (s: string) => s.toLowerCase();

// Does the citation point at something this run really has? The model
// proposes; this decides.
export function resolves(e: Evidence | undefined, r: Resolver): boolean {
  if (!e || !r.green) return false;
  const ref = e.ref.trim();
  if (!ref) return false;
  switch (e.kind) {
    case "test": {
      const tests = r.commands.filter((c) => c.name === "test");
      if (!tests.length || tests.some((c) => c.exitCode !== 0)) return false;
      const want = lower(ref);
      return tests.some((c) =>
        c.passed.some((p) => lower(p).includes(want) || want.includes(lower(p)))
      );
    }
    case "typecheck":
      return r.commands.some((c) => c.name === "typecheck" && c.exitCode === 0);
    case "diff": {
      const m = /^(.*?)(?::(\d+))?$/.exec(ref);
      const file = m?.[1] ?? ref;
      const ranges = r.hunks.get(file);
      if (!ranges) return false;
      if (!m?.[2]) return true;
      const line = Number(m[2]);
      return ranges.some(([a, b]) => line >= a && line <= b);
    }
    case "ci":
      return r.ci.some(
        (c) =>
          lower(c.name) === lower(ref) &&
          c.state === "success" &&
          c.sha === r.snapshotSha
      );
  }
}

export interface Mark {
  id: number;
  status: CriterionStatus;
  evidence: Evidence | null;
  verified: boolean;
}

// The analyst's marks, checked. "met" with no resolving citation stays open
// and is shown as unverified; a criterion the analyst didn't mention goes
// back to open (met at one snapshot is not met at the next); waived stays.
export function checkCriteria(
  criteria: Pick<Criterion, "id" | "status">[],
  analysis: Pick<Analysis, "criteria">,
  r: Resolver
): Mark[] {
  const said = new Map(analysis.criteria.map((c) => [c.id, c]));
  return criteria.map((c) => {
    if (c.status === "waived")
      return { id: c.id, status: "waived", evidence: null, verified: true };
    const a = said.get(c.id);
    if (!a) return { id: c.id, status: "open", evidence: null, verified: true };
    if (a.status !== "met")
      return {
        id: c.id,
        status: a.status,
        evidence: a.evidence ?? null,
        verified: true,
      };
    return resolves(a.evidence, r)
      ? { id: c.id, status: "met", evidence: a.evidence!, verified: true }
      : {
          id: c.id,
          status: "open",
          evidence: a.evidence ?? null,
          verified: false,
        };
  });
}
