import { git } from "../git-exec";
import { parseHunks } from "./checkCriteria";

const PATCH_CAP = 40_000;

// What the analyst is shown of the change: the branch's stat, then the
// patch since the last cycle, whole when it is small and hunk headers only
// when it isn't (it can Read any file for the rest).
export async function diffMap(
  dir: string,
  base: string,
  sha: string,
  since: string | null
): Promise<{ map: string; hunks: Map<string, [number, number][]> }> {
  const [stat, zero, patch] = await Promise.all([
    git(dir, ["diff", "--stat", "--no-color", `${base}...${sha}`]).catch(
      () => ""
    ),
    git(dir, ["diff", "-U0", "--no-color", `${base}...${sha}`]).catch(() => ""),
    since
      ? git(dir, ["diff", "--no-color", `${since}..${sha}`]).catch(() => "")
      : git(dir, ["diff", "--no-color", `${base}...${sha}`]).catch(() => ""),
  ]);
  const body =
    patch.length <= PATCH_CAP
      ? patch
      : patch
          .split("\n")
          .filter((l) => l.startsWith("diff --git") || l.startsWith("@@"))
          .join("\n")
          .slice(0, PATCH_CAP);
  const map = [
    `Whole branch against ${base}:\n${stat.trim() || "(no changes)"}`,
    since
      ? `Since the last cycle:\n${body.trim() || "(nothing)"}`
      : `Patch:\n${body.trim() || "(nothing)"}`,
  ].join("\n\n");
  return { map, hunks: parseHunks(zero) };
}
