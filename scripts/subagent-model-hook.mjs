#!/usr/bin/env node
// A Claude Code PreToolUse hook for the Agent/Task tool: it sets the model of
// a subagent call from its type, so read-only searches run on a cheaper
// model. AgentOS copies it to ~/.agent-os/bin/agentos-subagent-model and
// lists it in the settings it passes to terminal Claude sessions; chat
// sessions run the same rule in-process (lib/models/subagents.ts). The map
// (subagent type or "prefix*" to haiku|sonnet|opus|inherit) is JSON in
// AGENTOS_SUBAGENT_MODELS. It always exits 0: a hook that fails must never
// break the session.

import { pathToFileURL } from "node:url";

// The tier for a subagent type: an exact entry, else the longest "prefix*".
export function tierFor(type, map) {
  if (typeof type !== "string" || !map || typeof map !== "object") return null;
  if (Object.hasOwn(map, type)) return map[type];
  let best = null;
  for (const pattern of Object.keys(map)) {
    if (!pattern.endsWith("*")) continue;
    const prefix = pattern.slice(0, -1);
    if (
      type.startsWith(prefix) &&
      (best === null || prefix.length > best.length)
    )
      best = prefix;
  }
  return best === null ? null : map[`${best}*`];
}

// The call's input with its model set, or null to leave the call alone. A
// caller's own choice is kept, except Haiku on a type routed higher: those
// decide, and never run on Haiku.
export function routeAgentInput(toolInput, map) {
  const type = toolInput?.subagent_type;
  if (type === "fork") return null;
  const tier = tierFor(type, map);
  if (!tier || tier === "inherit") return null;
  const asked = toolInput.model;
  if (asked === undefined || asked === null || asked === "")
    return { ...toolInput, model: tier };
  if (asked === "haiku" && tier !== "haiku")
    return { ...toolInput, model: tier };
  return null;
}

async function main() {
  let map;
  try {
    map = JSON.parse(process.env.AGENTOS_SUBAGENT_MODELS || "");
  } catch {
    return;
  }
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const call = JSON.parse(input);
  if (call.tool_name !== "Agent" && call.tool_name !== "Task") return;
  const updatedInput = routeAgentInput(call.tool_input, map);
  if (updatedInput)
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput },
      })
    );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  main().catch(() => {});
