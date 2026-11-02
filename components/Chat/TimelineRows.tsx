"use client";

import type { StepCounts } from "@/lib/chat/tool-outcome";
import { Fragment, memo, useMemo } from "react";
import {
  groupTimeline,
  sameBlock,
  STANDALONE_TOOLS,
  type TimelineBlock,
} from "@/lib/chat/group";
import type { ApprovalDecision, ChatItem } from "@/lib/chat/events";
import { Approval } from "./Approval";
import { SubagentCard } from "./Subagent";
import { UndoneBlock } from "./Undo";
import { ToolGroup } from "./Tools";
import { McpServers } from "./McpServers";
import { ArtifactCard } from "./Artifact";
import { PlanCard } from "./PlanCard";
import { UserTurn } from "./EventRow";
import { EventGroup } from "./EventTurns";
import { NewDivider } from "./NewDivider";
import {
  AssistantMessage,
  CommandOutput,
  Compacted,
  SkillChip,
  ErrorMessage,
  NoteLine,
  Reasoning,
  Todos,
  TurnEnd,
} from "./Messages";

export interface ItemActions {
  respond: (id: string, answer: ApprovalDecision) => void;
  // Absent inside undone messages; hidden while the agent works (ChatIdle).
  onCarryPlan?: (id: string) => void;
  onKeepPlanning?: () => void;
  // Absent inside undone messages; hidden while the agent works (ChatIdle).
  onUndo?: (id: string) => void;
  onQuote?: (text: string) => void;
}

function Item({
  item,
  actions,
  steps,
}: {
  item: ChatItem;
  actions: ItemActions;
  steps?: StepCounts;
}) {
  switch (item.kind) {
    case "user":
      return (
        <UserTurn
          item={item}
          onUndo={
            item.checkpoint && actions.onUndo
              ? () => actions.onUndo?.(item.id)
              : undefined
          }
        />
      );
    case "assistant":
      return <AssistantMessage item={item} onQuote={actions.onQuote} />;
    case "reasoning":
      return <Reasoning item={item} />;
    case "todos":
      return <Todos item={item} />;
    case "turn_end":
      return <TurnEnd item={item} steps={steps} />;
    case "error":
      return <ErrorMessage item={item} />;
    case "command_output":
      return <CommandOutput item={item} />;
    case "mcp":
      return <McpServers item={item} />;
    case "compacted":
      return <Compacted item={item} />;
    case "note":
      return <NoteLine item={item} />;
    case "artifact":
      return <ArtifactCard item={item} />;
    case "approval":
      return <Approval item={item} respond={actions.respond} />;
    case "plan":
      return (
        <PlanCard
          item={item}
          onCarryOut={
            actions.onCarryPlan
              ? () => actions.onCarryPlan?.(item.id)
              : undefined
          }
          onKeepPlanning={() => actions.onKeepPlanning?.()}
        />
      );
    case "tool":
      return item.name === "Skill" ? (
        <SkillChip item={item} />
      ) : STANDALONE_TOOLS.has(item.name) ? (
        <SubagentCard item={item} />
      ) : null;
    default:
      return null;
  }
}

function Timeline({
  blocks,
  actions,
}: {
  blocks: TimelineBlock[];
  actions: ItemActions;
}) {
  return blocks.map((b) => (
    <Block
      key={b.type === "item" ? b.item.id : b.id}
      block={b}
      actions={actions}
    />
  ));
}

const blockKey = (b: TimelineBlock) => (b.type === "item" ? b.item.id : b.id);

// One block, re-rendered only when its items or the actions change: a long
// conversation doesn't redraw every message for each streamed word.
const Block = memo(
  function Block({
    block: b,
    actions,
  }: {
    block: TimelineBlock;
    actions: ItemActions;
  }) {
    const respond = actions.respond;
    const undoneActions = useMemo(
      () => ({ respond, onQuote: actions.onQuote }),
      [respond, actions.onQuote]
    );
    return b.type === "tools" ? (
      <ToolGroup tools={b.tools} />
    ) : b.type === "events" ? (
      <EventGroup
        id={b.id}
        turns={b.turns}
        renderReplies={(items) => (
          <Timeline blocks={groupTimeline(items)} actions={undoneActions} />
        )}
      />
    ) : b.type === "undone" ? (
      <UndoneBlock
        undo={b.undo}
        count={b.items.filter((i) => i.kind === "user").length}
      >
        <Timeline blocks={groupTimeline(b.items)} actions={undoneActions} />
      </UndoneBlock>
    ) : (
      <div data-item={b.item.id}>
        <Item item={b.item} actions={actions} steps={b.steps} />
      </div>
    );
  },
  (prev, next) =>
    prev.actions === next.actions && sameBlock(prev.block, next.block)
);

// The conversation's rows in the page's flow, not a virtualized list: a
// selection follows the DOM, and a list that recycles and re-orders its rows
// breaks it (docs/decisions/2026-10-11-chat-timeline-in-flow.md).
export function TimelineRows({
  blocks,
  actions,
  newFrom,
}: {
  blocks: TimelineBlock[];
  actions: ItemActions;
  // The block the reader hasn't seen yet begins at, when they were away.
  newFrom?: string | null;
}) {
  return blocks.map((b) => (
    <Fragment key={blockKey(b)}>
      {newFrom === blockKey(b) && <NewDivider />}
      <div
        data-block={blockKey(b)}
        className="chat-row mx-auto w-full max-w-3xl px-4 pb-4"
      >
        <Block block={b} actions={actions} />
      </div>
    </Fragment>
  ));
}
