import { estTokens } from "../session-audit/normalize";
import type { ExportDoc } from "./build";
import type { Selected } from "./summary";
import {
  DANGER_TOKENS,
  MAX_EXPORT_BYTES,
  WARN_TOKENS,
  type ExportMode,
  type ExportRedact,
  type ExportTurnInfo,
  type ExportWarning,
  type Size,
} from "./view";

export const sizeOf = (file: string): Size => ({
  bytes: Buffer.byteLength(file, "utf8"),
  tokens: estTokens(file.length),
});

/** Every turn of the doc, for the range pickers: when, what, how big. */
export function turnInfos(doc: ExportDoc): ExportTurnInfo[] {
  return doc.turns.map((t) => ({
    n: t.n,
    at: t.startedAt,
    id: t.userId,
    excerpt: t.excerpt,
    items: t.items.length,
    tokens: estTokens(JSON.stringify(t.items).length),
  }));
}

export function warningsFor(
  s: Selected,
  size: Size,
  opts: { mode: ExportMode; redact: ExportRedact }
): ExportWarning[] {
  const out: ExportWarning[] = [];
  if (size.bytes > MAX_EXPORT_BYTES)
    out.push({
      level: "danger",
      code: "too-big",
      text: "Over the 25 MB limit. Pick a shorter range or use Compact.",
    });
  if (size.tokens > DANGER_TOKENS)
    out.push({
      level: "danger",
      code: "huge",
      text: "Too big for any model in one go. Split it into ranges.",
    });
  else if (size.tokens > WARN_TOKENS)
    out.push({
      level: "warn",
      code: "large",
      text: "Larger than many models' context windows (often 128k to 200k tokens). Try Compact or a shorter range.",
    });
  if (opts.redact === "secrets")
    out.push({
      level: "warn",
      code: "paths-included",
      text: "Your paths, machine names and emails are included. Credentials are still masked.",
    });
  if (
    opts.mode === "full" &&
    s.turns.some((t) => t.items.some((i) => i.output || i.diff?.patch))
  )
    out.push({
      level: "warn",
      code: "full-output",
      text: "Full tool output can contain file contents and logs.",
    });
  if (s.hits.secret > 0)
    out.push({
      level: "warn",
      code: "secrets-found",
      text: `${s.hits.secret} ${s.hits.secret === 1 ? "credential was" : "credentials were"} found and masked. Check the output for any we missed.`,
    });
  out.push({
    level: "info",
    code: "sensitive",
    text: "Exports can include code, file contents and command output. Read it before you upload it anywhere.",
  });
  return out;
}
