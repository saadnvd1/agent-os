/**
 * Why a model in the server's list can't be picked for a role, and the name
 * a role's default shows. Imported by the browser too, so no Node modules.
 */

import { modelDisplayName } from "../model-catalog";
import { ANTHROPIC } from "./roles";
import type { ModelChoice } from "./catalog";

// Why a model can't be picked for an analyst, or null when it can. An
// analyst reads code and transcripts through tools, so a model that can't
// call them is out; one whose server isn't answering is too.
export function analystBlock(
  c: Pick<ModelChoice, "unusable" | "toolUse" | "availability" | "agent">,
  opts: { agent?: "claude" | "pi" } = {}
): string | null {
  if (c.unusable) return c.unusable;
  if (!c.toolUse) return "Can't call tools";
  if (c.availability.state === "down")
    return c.availability.error
      ? `Not answering (${c.availability.error})`
      : "Not answering";
  if (opts.agent && c.agent !== opts.agent)
    return c.agent === "pi"
      ? "Runs on Pi: start a new analyst on it"
      : "Runs on Claude Code: start a new analyst on it";
  return null;
}

// "Opus 5.5" for an Anthropic ref, the list's own label for any other.
export function defaultModelName(
  ref: string | null | undefined,
  choices: Pick<ModelChoice, "ref" | "label">[]
): string {
  if (!ref) return "…";
  const found = choices.find((c) => c.ref === ref);
  if (ref.startsWith(`${ANTHROPIC}/`))
    return modelDisplayName(ref.slice(ANTHROPIC.length + 1));
  return found?.label ?? ref.split("/").slice(1).join("/");
}

export const defaultAnalystLabel = (
  ref: string | null | undefined,
  choices: Pick<ModelChoice, "ref" | "label">[]
) => `Default analyst model (${defaultModelName(ref, choices)})`;
