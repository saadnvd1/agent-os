/**
 * The model list in a role session's composer. A chat's own list is whatever
 * its agent reports (for Claude Code, only Claude's aliases), so an analyst
 * would never be offered Qwen, Pi's models or DeepSeek. An analyst's list is
 * the server's one catalog instead, with each model it can't move to greyed
 * and given the reason.
 */

import type { Session } from "../db";
import { modelDisplayName } from "../model-catalog";
import { modelCatalog, unconfiguredChoices } from "../models/catalog";
import { PI } from "../models/providers";
import { sessionModelRef } from "../models/resolve";
import { ANTHROPIC } from "../models/roles";
import { analystBlock } from "../models/usable";
import type { ChatModel } from "./events";

const isAnalystChat = (s: Session) =>
  s.agent_role === "analyst" &&
  (s.agent_type === "claude" || s.agent_type === "pi");

// The session's model as a ref, which is what its list's values are.
export const composerModelValue = (s: Session): string =>
  s.agent_type === "pi" ? `${PI}/${s.model}` : sessionModelRef(s);

export function roleComposerModels(
  session: Session,
  own: ChatModel[]
): ChatModel[] {
  if (!isAnalystChat(session)) return own;
  const agent = session.agent_type === "pi" ? "pi" : "claude";
  const list = [...modelCatalog(), ...unconfiguredChoices()].map(
    (c): ChatModel => {
      const disabled = analystBlock(c, { agent });
      return {
        value: c.ref,
        label: c.ref.startsWith(`${ANTHROPIC}/`)
          ? modelDisplayName(c.label)
          : c.label,
        description: c.group,
        ...(disabled && { disabled }),
      };
    }
  );
  return list.length ? list : own;
}
