import type { ChatModel } from "@/lib/chat/events";
import type { Draft } from "@/lib/drafts";
import { discoversModels, getModelOptions } from "@/lib/model-catalog";

// A fixed list, or the agent's default followed by what it reports; while it
// loads or if it fails, the default alone says so.
export function draftModels(
  agentType: Draft["agentType"],
  found: { data?: ChatModel[]; isPending: boolean; isError: boolean }
): ChatModel[] {
  const options = getModelOptions(agentType);
  if (!discoversModels(agentType)) return options;
  if (found.data) return [...options, ...found.data];
  const [first, ...rest] = options;
  const note = found.isError ? "couldn't list models" : "loading models…";
  return [{ ...first, label: `${first.label} (${note})` }, ...rest];
}
