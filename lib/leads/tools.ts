// The tool calls of a workspace's standing sessions, as the server answers
// them: the caller's profile decides which tools it has, a lead's starts
// and stops stay inside its area, and what it does is recorded as its own.

import { z } from "zod";
import type { Session } from "@/lib/db/types";
import { isToolName, runTool } from "../orchestrator/serve";
import { owner } from "../owner";
import { asActor } from "./actor";
import { areaRefusal } from "./area";
import { currentDirection, openProposals, proposePin } from "./direction";
import { leadTitle, listLeads } from "./home";
import { messageLead } from "./mail";
import { leadStartRefusal } from "./start-check";
import { latestMemo, writeMemo } from "./memos";
import {
  isLeadToolName,
  profileFor,
  profileHas,
  type LeadToolName,
  type Profile,
} from "./profiles";
import { isLeadKind, leadKindOf, roleNoun } from "./roles";
import { hasLeads } from "./settings";
import type { LeadKind } from "./types";

export const LEAD_TOOL_SHAPES = {
  update_memo: {
    text: z
      .string()
      .trim()
      .min(1)
      .max(6000)
      .describe(
        "The whole memo, rewritten: what you're working on, what's decided, what's next"
      ),
  },
  propose_pin: {
    item: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe("The chat item id of the owner's message to pin"),
  },
  direction: {
    lead: z
      .string()
      .trim()
      .max(32)
      .optional()
      .describe(
        "Another lead's kind (marketing, product, tech); yours if left out"
      ),
  },
  message_lead: {
    to: z
      .string()
      .trim()
      .min(1)
      .max(32)
      .describe("The lead's kind: tech, marketing, product…"),
    thread: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .describe(
        "The topic in a few words. The same topic with the same lead stays on one thread"
      ),
    text: z.string().trim().min(1).max(4000),
    pins: z
      .array(z.number().int().positive())
      .max(5)
      .optional()
      .describe(
        "Ids of your pinned direction this relies on. The server quotes the owner's words with them; without one, a claim that the owner approved something reads as unattested"
      ),
  },
} satisfies Record<LeadToolName, z.ZodRawShape>;

export const LEAD_TOOL_DESCRIPTIONS: Record<LeadToolName, string> = {
  update_memo:
    "Rewrite your memo: the short note (about 1.5k tokens) you carry across a fresh start, with your pinned direction. Every version is kept.",
  propose_pin:
    "Propose one of the owner's own messages in your chat as pinned direction. The quote is copied by the server, and it is direction only once he confirms it with a tap.",
  direction:
    "The pinned direction in force for you or another lead of this workspace (newest first), with your open proposals and memo.",
  message_lead:
    "Write to another lead of this workspace on a thread (one per topic). It arrives in their chat, fenced as a lead's words, with the pins you cite quoted by the server. A few messages an hour per thread; past that it goes to the owner as an ask, so don't retry.",
};

function parseLeadArgs<T extends LeadToolName>(tool: T, args: unknown) {
  const parsed = z
    .object(LEAD_TOOL_SHAPES[tool])
    .strict()
    .safeParse(args ?? {});
  if (!parsed.success)
    throw new Error(
      `Bad arguments for ${tool}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "args"} ${i.message}`).join("; ")}`
    );
  return parsed.data as unknown as z.infer<
    z.ZodObject<(typeof LEAD_TOOL_SHAPES)[T]>
  >;
}

function directionText(w: string, kind: LeadKind, me: LeadKind): string {
  const pins = currentDirection(w, kind);
  const title = leadTitle(w, kind);
  const lines = [
    pins.length
      ? `Pinned direction for the ${title}, from ${owner()}, newest first:\n${pins.map((p) => `- [pin ${p.id}, ${p.setAt.slice(0, 10)}] "${p.quote}"`).join("\n")}`
      : `The ${title} has no pinned direction.`,
  ];
  if (kind === me) {
    const open = openProposals(w, kind);
    if (open.length)
      lines.push(
        `Proposed, waiting for ${owner()}'s tap:\n${open.map((p) => `- [proposal ${p.id}] "${p.quote}"`).join("\n")}`
      );
    const memo = latestMemo(w, kind);
    lines.push(memo ? `Your memo:\n${memo.text}` : "You have no memo yet.");
  }
  return lines.join("\n\n");
}

function runLeadTool(
  w: string,
  caller: Session,
  kind: LeadKind,
  tool: LeadToolName,
  raw: unknown
): string | Promise<string> {
  switch (tool) {
    case "update_memo": {
      const memo = writeMemo(w, kind, parseLeadArgs(tool, raw).text);
      return `Memo saved (${memo.text.length} characters). A fresh start reads it with your pinned direction.`;
    }
    case "propose_pin": {
      const out = proposePin({
        workspaceId: w,
        leadKind: kind,
        sessionId: caller.id,
        chatItemId: parseLeadArgs(tool, raw).item,
      });
      if ("error" in out) throw new Error(out.error);
      return `Proposed as pin ${out.id}: "${out.quote}". It's direction once ${owner()} confirms it.`;
    }
    case "direction": {
      const lead = parseLeadArgs(tool, raw).lead ?? kind;
      if (!isLeadKind(lead)) throw new Error(`No lead "${lead}"`);
      if (!listLeads(w).some((s) => leadKindOf(s) === lead))
        throw new Error(`This workspace has no ${lead} lead`);
      return directionText(w, lead, kind);
    }
    case "message_lead":
      return messageLead(w, caller, kind, parseLeadArgs(tool, raw));
  }
}

export class NotYours extends Error {}
export class UnknownTool extends Error {}

// One tool call from a standing session. Unknown names stay "unknown", as
// they always were; a known tool outside the caller's profile is refused.
export async function runStandingTool(
  w: string,
  caller: Session,
  tool: string,
  args: unknown
): Promise<string> {
  const profile: Profile | null = profileFor(caller, hasLeads(w));
  if (!profile)
    throw new NotYours(`The ${roleNoun(caller.role)} has no tools here yet`);
  if (!isToolName(tool) && !isLeadToolName(tool))
    throw new UnknownTool("Unknown tool");
  if (!profileHas(profile, tool))
    throw new NotYours(
      `${tool} isn't one of your tools as ${leadTitle(w, profile.kind)}: it's the Tech lead's. Hand it over with message_lead (to "tech").`
    );
  if (isLeadToolName(tool))
    return runLeadTool(w, caller, profile.kind, tool, args);
  if (!isToolName(tool)) throw new UnknownTool("Unknown tool");
  const refusal = profile.inArea
    ? areaRefusal(w, profile.kind, tool, args)
    : null;
  if (refusal) throw new Error(refusal);
  const taken = hasLeads(w)
    ? await leadStartRefusal(w, profile.kind, tool, args)
    : null;
  if (taken) throw new Error(taken);
  return asActor(caller, () => runTool(w, tool, args ?? {}));
}
