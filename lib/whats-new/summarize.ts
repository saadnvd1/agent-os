import { z } from "zod";
import { KINDS, type Kind } from "./schema";

export type Line = { skip: true } | { kind: Kind; text: string };

const LINE = /^\s*Whats-new:\s*(.+?)\s*$/gim;
const KIND_BY_NAME: Record<string, Kind> = {
  new: "new",
  improved: "improved",
  fixed: "fixed",
};

export const tidy = (text: string) => {
  const t = text.replace(/\s+/g, " ").trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
};

/** The author's line from a PR body (the last one wins); null when absent or malformed. */
export function authorLine(body: string | null | undefined): Line | null {
  if (!body) return null;
  let last: string | undefined;
  for (const m of body.slice(0, 65_536).matchAll(LINE)) last = m[1];
  if (!last) return null;
  if (/^skip\.?$/i.test(last)) return { skip: true };
  const m = /^(new|improved|fixed)\s*[—–:-]+\s*(.+)$/i.exec(last);
  if (!m) return null;
  return { kind: KIND_BY_NAME[m[1].toLowerCase()], text: tidy(m[2]) };
}

export const GAP_SYSTEM = `You write one line of a changelog for people who use a coding-agent app. You get a JSON list of merged changes, each only a commit subject. Answer with a JSON array and nothing else: one object per item, {"n": <n>, "kind": "new" | "improved" | "fixed", "text": "<sentence>"}, or {"n": <n>, "skip": true} when a user would not see the change.

Rules for text: one plain sentence under 140 characters that says what a user can now do or what stopped going wrong. Say nothing the subject does not say. No jargon, no file or function names, no paths, no emoji, no dashes used as punctuation, never the word "improved", and no marketing words. "new" is something that did not exist, "fixed" is something that was broken, "improved" is something that already existed and works better.`;

export interface GapItem {
  n: number;
  type: string;
  title: string;
}

const answer = z.array(
  z.union([
    z.object({ n: z.number(), skip: z.literal(true) }),
    z.object({
      n: z.number(),
      kind: z.enum(KINDS),
      text: z.string().min(1).max(400),
    }),
  ])
);

export function parseAnswer(raw: string): Map<number, Line> {
  const out = new Map<number, Line>();
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end < start) return out;
  let json: unknown;
  try {
    json = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return out;
  }
  const parsed = answer.safeParse(json);
  if (!parsed.success) return out;
  for (const r of parsed.data)
    out.set(
      r.n,
      "skip" in r ? { skip: true } : { kind: r.kind, text: tidy(r.text) }
    );
  return out;
}

export type Ask = (system: string, prompt: string) => Promise<string>;

const BATCH = 80;

/** Haiku sees the commit subject only: never the diff and never the PR body. */
export async function fillGaps(
  items: GapItem[],
  ask: Ask
): Promise<Map<number, Line>> {
  const out = new Map<number, Line>();
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    const prompt = JSON.stringify(
      batch.map(({ n, type, title }) => ({ n, type, subject: title }))
    );
    for (const [n, line] of parseAnswer(await ask(GAP_SYSTEM, prompt)))
      if (batch.some((b) => b.n === n)) out.set(n, line);
  }
  return out;
}
