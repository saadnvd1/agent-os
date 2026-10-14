/**
 * Routing a subagent's model by its type. Claude Code takes a subagent's
 * model from the call, then its definition (the built-in Explore and Plan
 * say "inherit"), then the session's: so a PreToolUse hook sets the call's
 * own model. The map rides in the session's environment; a routed provider
 * gets none (its tiers are mapped in lib/models/resolve instead).
 */

import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";
import {
  routeAgentInput,
  tierFor,
} from "../../scripts/subagent-model-hook.mjs";
import { effectiveModels } from "./config";
import { SUBAGENTS_ENV } from "./subagent-env";
import {
  DEFAULT_SUBAGENT_MODELS,
  SUBAGENT_TIERS,
  type SubagentModels,
} from "./subagent-tiers";

export { routeAgentInput, tierFor };

export const effectiveSubagentModels = (
  saved?: SubagentModels
): SubagentModels => ({ ...DEFAULT_SUBAGENT_MODELS, ...saved });

// The environment that turns routing on for a session. A settings read that
// fails leaves the session unrouted rather than not started.
export function subagentEnv(): Record<string, string> {
  try {
    return { [SUBAGENTS_ENV]: JSON.stringify(effectiveModels().subagents) };
  } catch (error) {
    console.warn("[models] subagent routing off:", error);
    return {};
  }
}

// The map from a session's environment, or null when routing is off.
export function parseSubagentEnv(
  raw: string | undefined
): SubagentModels | null {
  if (!raw) return null;
  try {
    const map = JSON.parse(raw) as Record<string, unknown>;
    const valid = Object.entries(map).filter(([, t]) =>
      (SUBAGENT_TIERS as readonly unknown[]).includes(t)
    );
    return valid.length ? (Object.fromEntries(valid) as SubagentModels) : null;
  } catch {
    return null;
  }
}

// The same rule as the terminal hook script, for chat sessions.
export function subagentModelHook(map: SubagentModels): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    if (input.tool_name !== "Agent" && input.tool_name !== "Task") return {};
    const updatedInput = routeAgentInput(
      (input.tool_input ?? {}) as Record<string, unknown>,
      map
    );
    if (!updatedInput) return {};
    return {
      hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput },
    };
  };
}
