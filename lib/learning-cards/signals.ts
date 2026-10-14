// Zero-token check for "this session is probably a recipe".

import { parseResult } from "../recipes/result";
import type { SessionInput } from "./types";

// First words of a command that reach outside the repo.
export const EXTERNAL_CLIS = [
  "asc",
  "eas",
  "tv",
  "gh api",
  "gh release",
  "xcrun",
  "fastlane",
  "curl",
  "aws",
  "gcloud",
  "kubectl",
];

export interface RecipeSignals {
  hit: boolean;
  signals: string[];
}

// "cd x && FOO=1 npx eas submit" -> "eas submit".
export function commandStart(command: string): string {
  const parts = command.split(/\s*(?:&&|;)\s*/).map((p) => p.trim());
  const real = parts.find((p) => p && !/^cd\s/.test(p)) ?? "";
  return real
    .replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, "")
    .replace(/^(?:npx|bunx|sudo|time)\s+/, "");
}

export const isExternal = (command: string): boolean => {
  const start = commandStart(command);
  return EXTERNAL_CLIS.some((c) => start === c || start.startsWith(`${c} `));
};

const FACT_PATTERNS = [
  /\b(?:build|run|release)\s*#?\d+/i,
  /#\d{2,}/,
  /\b\d+\.\d+\.\d+\b/,
  /\b[0-9a-f]{7,}\b/i,
  /^\s*[-*]?\s*[A-Za-z][\w ]{1,24}:\s+\S+/m,
];

export function hasFacts(final: string): boolean {
  if (parseResult(final)) return true;
  return FACT_PATTERNS.filter((p) => p.test(final)).length >= 2;
}

const STOP = new Set(
  "a an and are as at be but by do for from has have in into is it its of on or that the this to was we with you your please then than so if not can will just all any also".split(
    " "
  )
);

export function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w))
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let both = 0;
  for (const w of a) if (b.has(w)) both++;
  return both / (a.size + b.size - both);
}

export const REPEAT_AT = 0.6;
const MIN_WORDS = 4;

export function repeats(brief: string, earlier: string[]): boolean {
  const mine = words(brief);
  if (mine.size < MIN_WORDS) return false;
  return earlier.some((b) => jaccard(mine, words(b)) >= REPEAT_AT);
}

export function recipeSignals(input: SessionInput): RecipeSignals {
  if (input.skip || input.run) return { hit: false, signals: [] };
  const signals: string[] = [];
  const external = input.steps.some(
    (s) => s.kind === "tool" && s.name === "Bash" && isExternal(s.command)
  );
  if (external) signals.push("external");
  if (!input.inRepo) signals.push("outside-repo");
  if (hasFacts(input.final)) signals.push("facts");
  if (repeats(input.brief, input.recentBriefs)) signals.push("repeat");
  const hit =
    signals.includes("repeat") ||
    ((external || !input.inRepo) && signals.includes("facts"));
  return { hit, signals };
}
