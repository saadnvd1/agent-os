"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@/data/chat/useChat";
import {
  groupTimeline,
  STANDALONE_TOOLS,
  type TimelineBlock,
} from "@/lib/chat/group";
import type { ApprovalDecision, ChatItem } from "@/lib/chat/events";
import { Approval } from "./Approval";
import { SubagentCard } from "./Subagent";
import { UndoDialog, UndoneBlock } from "./Undo";
import { Composer } from "./Composer";
import { ToolGroup } from "./Tools";
import {
  AssistantMessage,
  CommandOutput,
  Compacted,
  SkillChip,
  ErrorMessage,
  Reasoning,
  Todos,
  TurnEnd,
  UserMessage,
} from "./Messages";

interface ItemActions {
  respond: (id: string, answer: ApprovalDecision) => void;
  // Absent while the agent is working, and inside undone messages.
  onUndo?: (id: string) => void;
}

function Item({ item, actions }: { item: ChatItem; actions: ItemActions }) {
  switch (item.kind) {
    case "user":
      return (
        <UserMessage
          item={item}
          onUndo={
            item.checkpoint && actions.onUndo
              ? () => actions.onUndo?.(item.id)
              : undefined
          }
        />
      );
    case "assistant":
      return <AssistantMessage item={item} />;
    case "reasoning":
      return <Reasoning item={item} />;
    case "todos":
      return <Todos item={item} />;
    case "turn_end":
      return <TurnEnd item={item} />;
    case "error":
      return <ErrorMessage item={item} />;
    case "command_output":
      return <CommandOutput item={item} />;
    case "compacted":
      return <Compacted item={item} />;
    case "approval":
      return <Approval item={item} respond={actions.respond} />;
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
  return blocks.map((b) =>
    b.type === "tools" ? (
      <ToolGroup key={b.id} tools={b.tools} />
    ) : b.type === "undone" ? (
      <UndoneBlock
        key={b.id}
        undo={b.undo}
        count={b.items.filter((i) => i.kind === "user").length}
      >
        <Timeline
          blocks={groupTimeline(b.items)}
          actions={{ respond: actions.respond }}
        />
      </UndoneBlock>
    ) : (
      <Item key={b.item.id} item={b.item} actions={actions} />
    )
  );
}

export function ChatPanel({
  sessionId,
  sessionName,
}: {
  sessionId: string;
  sessionName: string;
}) {
  const [prefill, setPrefill] = useState<{ text: string; at: number }>();
  const {
    items,
    state,
    connected,
    commands,
    models,
    model,
    send,
    interrupt,
    setModel,
    access,
    setAccess,
    respond,
    undo,
    undoPreview,
    clearUndo,
  } = useChat(sessionId, (text) => setPrefill({ text, at: Date.now() }));
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  // Follow new output while the reader is at the bottom; leave them be if
  // they've scrolled up to read.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [items]);

  const running = state === "running" || state === "waiting";
  const blocks = groupTimeline(items);
  const actions: ItemActions = {
    respond,
    onUndo: running || !connected ? undefined : (id) => undo(id, true),
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-5">
          {blocks.length === 0 && (
            <p className="text-muted-foreground py-16 text-center text-sm">
              Ask anything to start.
            </p>
          )}
          <Timeline blocks={blocks} actions={actions} />
          {state === "running" && blocks.at(-1)?.type !== "tools" && (
            <p className="text-muted-foreground animate-pulse text-xs">
              Working…
            </p>
          )}
        </div>
      </div>
      <div className="mx-auto w-full max-w-3xl px-3 pb-3">
        <Composer
          running={running}
          disabled={!connected}
          placeholder={connected ? `Message ${sessionName}` : "Reconnecting…"}
          onSend={(text, images) => {
            pinned.current = true;
            send(text, images.length ? images : undefined);
          }}
          onStop={interrupt}
          commands={commands}
          models={models}
          model={model}
          onSetModel={setModel}
          access={access}
          onSetAccess={setAccess}
          prefill={prefill}
        />
      </div>
      {undoPreview && (
        <UndoDialog
          preview={undoPreview.preview}
          onClose={clearUndo}
          onConfirm={() => undo(undoPreview.from, false)}
        />
      )}
    </div>
  );
}
