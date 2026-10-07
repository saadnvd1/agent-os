"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@/data/chat/useChat";
import {
  groupTimeline,
  sameBlock,
  STANDALONE_TOOLS,
  type TimelineBlock,
} from "@/lib/chat/group";
import type { ApprovalDecision, ChatItem } from "@/lib/chat/events";
import {
  escapeAction,
  GHOST_SELECTOR,
  OVERLAY_SELECTOR,
} from "@/lib/chat/escape";
import { sentPrompts } from "@/lib/chat/history";
import { quoteMarkdown } from "@/lib/chat/quote";
import { OrchestratorBar } from "@/components/Orchestrator/OrchestratorBar";
import { ActivityLine } from "./Activity";
import { Approval } from "./Approval";
import { BackgroundTasks } from "./BackgroundTasks";
import { SubagentCard } from "./Subagent";
import { UndoDialog, UndoneBlock } from "./Undo";
import { Composer } from "./Composer";
import { Queue } from "./Queue";
import { QuoteButton } from "./QuoteButton";
import { ToolGroup } from "./Tools";
import { McpServers } from "./McpServers";
import { ArtifactCard } from "./Artifact";
import { PlanCard } from "./PlanCard";
import { ContextMeter } from "./ContextMeter";
import { SetupCard } from "./SetupCard";
import { useViewport } from "@/hooks/useViewport";
import { useChatCommands } from "./useChatCommands";
import {
  AssistantMessage,
  CommandOutput,
  Compacted,
  PeerMessage,
  SkillChip,
  ErrorMessage,
  NoteLine,
  Reasoning,
  Todos,
  TurnEnd,
  UserMessage,
} from "./Messages";

interface ItemActions {
  respond: (id: string, answer: ApprovalDecision) => void;
  // Absent while the agent is working, and inside undone messages.
  onCarryPlan?: (id: string) => void;
  onKeepPlanning?: () => void;
  // Absent while the agent is working, and inside undone messages.
  onUndo?: (id: string) => void;
}

function Item({ item, actions }: { item: ChatItem; actions: ItemActions }) {
  switch (item.kind) {
    case "user":
      if (item.peer) return <PeerMessage item={item} peer={item.peer} />;
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
    const undoneActions = useMemo(() => ({ respond }), [respond]);
    return b.type === "tools" ? (
      <ToolGroup tools={b.tools} />
    ) : b.type === "undone" ? (
      <UndoneBlock
        undo={b.undo}
        count={b.items.filter((i) => i.kind === "user").length}
      >
        <Timeline blocks={groupTimeline(b.items)} actions={undoneActions} />
      </UndoneBlock>
    ) : (
      <Item item={b.item} actions={actions} />
    );
  },
  (prev, next) =>
    prev.actions === next.actions && sameBlock(prev.block, next.block)
);

export function ChatPanel({
  sessionId,
  sessionName,
  accessLocked = false,
  orchestratorOf,
}: {
  sessionId: string;
  sessionName: string;
  // Its access is set by its role (an orchestrator), not picked here.
  accessLocked?: boolean;
  // The workspace it orchestrates: its header line, Pause and asks show on top.
  orchestratorOf?: string | null;
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
    plan,
    setPlan,
    carryPlan,
    context,
    respond,
    undo,
    undoPreview,
    clearUndo,
    stopTask,
    loadTaskOutput,
    taskOutputs,
    queue,
    queueEdit,
    queueMove,
    queueDelete,
    queueSendNow,
    suggestion,
    requestFiles,
  } = useChat(sessionId, (text) => setPrefill({ text, at: Date.now() }));
  const { isMobile } = useViewport();
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  // Follow new output while the reader is at the bottom; leave them be if
  // they've scrolled up to read.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [items]);

  const running = state === "running" || state === "waiting";

  // The suggestion the reader set aside (typed over it, or Esc) stays hidden.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const shownSuggestion = suggestion === dismissed ? null : suggestion;
  const dismissSuggestion = useCallback((s: string) => setDismissed(s), []);
  const history = useMemo(() => sentPrompts(items), [items]);
  const [insert, setInsert] = useState<{ text: string; at: number }>();

  // Esc sets the composer's ghost text aside, or else stops the turn
  // (lib/chat/escape), from anywhere in this panel.
  const rootRef = useRef<HTMLDivElement>(null);
  const escape = useRef({ running, interrupt, suggestion });
  useEffect(() => {
    escape.current = { running, interrupt, suggestion };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const root = rootRef.current;
      if (!root?.contains(e.target as Node)) return;
      const overlay = !!document.querySelector(OVERLAY_SELECTOR);
      const ghost = !!root.querySelector(GHOST_SELECTOR);
      const action = escapeAction(e, escape.current.running, overlay, ghost);
      if (action === "interrupt") escape.current.interrupt();
      else if (action === "dismiss") setDismissed(escape.current.suggestion);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  const focusComposer = useCallback(
    () =>
      rootRef.current
        ?.querySelector<HTMLElement>(".chat-composer [contenteditable]")
        ?.focus(),
    []
  );
  const togglePlan = plan === null ? undefined : () => setPlan(!plan);
  const sendText = (text: string) => {
    pinned.current = true;
    send(text);
  };

  // Shift+Tab switches plan mode from the composer, as in the terminal.
  const shiftTab = useRef(togglePlan);
  useEffect(() => {
    shiftTab.current = togglePlan;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !e.shiftKey || e.metaKey || e.ctrlKey) return;
      const target = e.target as HTMLElement;
      if (
        !shiftTab.current ||
        !rootRef.current?.contains(target) ||
        !(target === rootRef.current || target.closest(".chat-composer"))
      )
        return;
      e.preventDefault();
      shiftTab.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  useChatCommands({
    sessionId,
    connected,
    running,
    context,
    plan,
    send: sendText,
    setPlan,
    interrupt,
    focusComposer,
  });

  const blocks = useMemo(() => groupTimeline(items), [items]);
  const idle = !running && connected;
  const actions: ItemActions = useMemo(
    () => ({
      respond,
      onUndo: idle ? (id) => undo(id, true) : undefined,
      onCarryPlan: idle ? carryPlan : undefined,
      onKeepPlanning: focusComposer,
    }),
    [respond, idle, undo, carryPlan, focusComposer]
  );

  return (
    // Focusable, so Esc reaches it from anywhere in the conversation.
    <div
      ref={rootRef}
      tabIndex={-1}
      className="flex h-full min-h-0 flex-col outline-none"
    >
      {orchestratorOf && <OrchestratorBar workspaceId={orchestratorOf} />}
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
          <SetupCard sessionId={sessionId} />
          {blocks.length === 0 && !queue.length && (
            <p className="text-muted-foreground py-16 text-center text-sm">
              Ask anything to start.
            </p>
          )}
          <Timeline blocks={blocks} actions={actions} />
        </div>
      </div>
      <div className="mx-auto w-full max-w-3xl px-3 pb-3">
        <ActivityLine items={items} state={state} onStop={interrupt} />
        <BackgroundTasks
          items={items}
          outputs={taskOutputs}
          onStop={stopTask}
          onLoadOutput={loadTaskOutput}
        />
        <QuoteButton
          rootRef={scrollRef}
          onQuote={(text) =>
            setInsert({ text: quoteMarkdown(text), at: Date.now() })
          }
        />
        <Queue
          queue={queue}
          running={running}
          onEdit={queueEdit}
          onMove={queueMove}
          onDelete={queueDelete}
          onSendNow={(id) =>
            queueSendNow(
              id,
              running ? items.findLast((i) => i.kind === "user")?.id : undefined
            )
          }
        />
        <Composer
          draftKey={sessionId}
          suggestion={shownSuggestion}
          onDismissSuggestion={dismissSuggestion}
          history={history}
          requestFiles={requestFiles}
          insert={insert}
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
          onSetAccess={accessLocked ? undefined : setAccess}
          plan={plan}
          onTogglePlan={togglePlan}
          // The phone's bar has no room for it; the desktop's carries it.
          accessory={
            isMobile ? <ContextMeter sessionId={sessionId} compact /> : null
          }
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
