// Whether two commits carry the same patch against a base, as `git
// patch-id` sees it. The one check behind both carry-overs of a decision
// across a rebase: the orchestrator's review (rebase.ts) and Saad's merge
// approval (approval-carry.ts).

import { git, gitFetch, gitOk } from "../git-exec";

const diffOf = (repo: string, base: string, head: string) =>
  git(repo, [
    "diff",
    "--no-color",
    "--no-ext-diff",
    "--full-index",
    `${base}...${head}`,
  ]).catch(() => null);

async function idOf(repo: string, diff: string): Promise<string | null> {
  return git(repo, ["patch-id", "--verbatim"], {
    input: diff,
    timeout: 30000,
  }).then(
    (out) => out.split(" ")[0] || null,
    () => null
  );
}

// A diff split by file, each without what a rebase legitimately changes
// (blob ids, line offsets), so two diffs can be compared file by file.
function byFile(diff: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const part of diff.split(/^(?=diff --git )/m)) {
    const name = part.match(/^diff --git a\/(.+?) b\//)?.[1];
    if (!name) continue;
    files.set(
      name,
      part
        .split("\n")
        .filter((l) => !l.startsWith("index "))
        .map((l) =>
          l.replace(/^(@@ )-\d+(?:,\d+)? \+\d+(?:,\d+)?( @@)/, "$1$2")
        )
        .join("\n")
    );
  }
  return files;
}

const names = (list: string[]) =>
  list.slice(0, 5).join(", ") +
  (list.length > 5 ? ` and ${list.length - 5} more` : "");

// What differs between two diffs, in a few words.
export function describeChange(before: string, after: string): string {
  const a = byFile(before);
  const b = byFile(after);
  const added = [...b.keys()].filter((f) => !a.has(f));
  const removed = [...a.keys()].filter((f) => !b.has(f));
  const changed = [...b.keys()].filter(
    (f) => a.has(f) && a.get(f) !== b.get(f)
  );
  const parts = [
    added.length && `now also touches ${names(added)}`,
    removed.length && `no longer touches ${names(removed)}`,
    changed.length && `changes differ in ${names(changed)}`,
  ].filter(Boolean);
  return parts.length
    ? `its patch changed: ${parts.join("; ")}`
    : "its patch changed";
}

// `from` and `to` against `base`: the same patch, or else a note on why not.
// Fails closed: a commit or diff that can't be read is never "the same".
export async function comparePatches(
  repo: string,
  base: string,
  from: string,
  to: string
): Promise<{ same: boolean; note: string }> {
  if (!(await gitOk(repo, ["cat-file", "-e", `${from}^{commit}`]))) {
    await gitFetch(repo, ["--quiet", "--", "origin", from], {
      timeout: 30000,
    }).catch(() => undefined);
    if (!(await gitOk(repo, ["cat-file", "-e", `${from}^{commit}`])))
      return {
        same: false,
        note: `the earlier commit ${from.slice(0, 7)} can't be read here, so the patches can't be compared`,
      };
  }
  const [before, after] = await Promise.all([
    diffOf(repo, base, from),
    diffOf(repo, base, to),
  ]);
  if (!before || !after)
    return { same: false, note: "its patch can't be read to compare" };
  const [x, y] = await Promise.all([idOf(repo, before), idOf(repo, after)]);
  if (x && x === y) return { same: true, note: "same patch" };
  return { same: false, note: describeChange(before, after) };
}
