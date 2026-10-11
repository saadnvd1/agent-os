"use client";

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArrowDown, Loader2 } from "lucide-react";
import type { ClipboardEvent } from "react";
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
import { StaleChip } from "./StaleChip";
import { composerCompacts } from "@/lib/chat/stale";
import { useFreshStartQuery } from "@/data/fresh-start";
import { QuoteButton } from "./QuoteButton";
import { ToolBodies, ToolGroup } from "./Tools";
import { RowState, RowStore } from "./rowState";
import { FindBar } from "./FindBar";
import { FIND_EVENT, isFindKey, useFind } from "./useFind";
import { McpServers } from "./McpServers";
import { ArtifactCard } from "./Artifact";
import { PlanCard } from "./PlanCard";
import { ContextMeter } from "./ContextMeter";
import { SetupCard } from "./SetupCard";
import { UserTurn } from "./EventRow";
import { useViewport } from "@/hooks/useViewport";
import { useChatCommands } from "./useChatCommands";
import { copySelection } from "./copy-selection";
import { arrivalKey, useStickToBottom } from "./stick-to-bottom";
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
      <div data-item={b.item.id}>
        <Item item={b.item} actions={actions} />
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
}: {
  blocks: TimelineBlock[];
  actions: ItemActions;
}) {
  return blocks.map((b) => (
    <div
      key={blockKey(b)}
      data-block={blockKey(b)}
      className="chat-row mx-auto w-full max-w-3xl px-4 pb-4"
    >
      <Block block={b} actions={actions} />
    </div>
  ));
}

export function ChatPanel({
  sessionId,
  sessionName,
  accessLocked = false,
  orchestratorOf,
  active,
}: {
  sessionId: string;
  sessionName: string;
  // Its access is set by its role (an orchestrator), not picked here.
  accessLocked?: boolean;
  // The workspace it orchestrates: its header line, Pause and asks show on top.
  orchestratorOf?: string | null;
  // The tab on show in the focused pane: opening it takes the caret.
  active: boolean;
}) {
  const [prefill, setPrefill] = useState<{ text: string; at: number }>();
  const {
    items,
    hasMore,
    loadingOlder,
    loadOlder,
    earlierTasks,
    toolBodies,
    requestToolBody,
    state,
    connected,
    commands,
    refreshCommands,
    refreshingCommands,
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
    search,
  } = useChat(sessionId, (text) => setPrefill({ text, at: Date.now() }));
  const { isMobile } = useViewport();
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Follows new output only while the reader is at the end; sending brings
  // them back there, wherever they'd scrolled.
  const {
    stuck,
    unread,
    toBottom: toEnd,
    release,
  } = useStickToBottom(listRef, sessionId, arrivalKey(items.at(-1)));

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
      // The find bar takes its own Esc.
      if ((e.target as Element).closest?.("[data-find-bar]")) return;
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
    toEnd();
    send(text);
  };
  // A chat past the compact threshold compacts before the next message
  // unless the reader picks "Send as-is", for that send only.
  const compactTokens = useFreshStartQuery().data?.compactTokens ?? 0;
  const [asIsFor, setAsIsFor] = useState<string | null>(null);
  const asIs = asIsFor === sessionId;
  const setAsIs = (on: boolean) => setAsIsFor(on ? sessionId : null);

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
  const tasks = useMemo(() => {
    if (!earlierTasks.length) return items;
    const loaded = new Set(items.map((i) => i.id));
    return earlierTasks.filter((t) => !loaded.has(t.id)).concat(items);
  }, [earlierTasks, items]);
  // A new conversation starts with every row closed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rowState = useMemo(() => new RowStore(), [sessionId]);
  const bodies = useMemo(
    () => ({ bodies: toolBodies, request: requestToolBody, connected }),
    [toolBodies, requestToolBody, connected]
  );
  const itemsById = useMemo(
    () => new Map(items.map((i) => [i.id, i])),
    [items]
  );
  const itemsByIdRef = useRef(itemsById);
  useEffect(() => {
    itemsByIdRef.current = itemsById;
  });
  const onCopy = useCallback(
    (e: ClipboardEvent<HTMLDivElement>) =>
      copySelection(e, itemsByIdRef.current),
    []
  );
  // Starts at the end; older pages load as the reader nears the top.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [sessionId]);
  const olderRef = useRef({ hasMore, loadingOlder, loadOlder });
  useEffect(() => {
    olderRef.current = { hasMore, loadingOlder, loadOlder };
  });
  const onListScroll = useCallback(() => {
    const el = listRef.current;
    const o = olderRef.current;
    if (el && o.hasMore && !o.loadingOlder && el.scrollTop < el.clientHeight)
      o.loadOlder();
  }, []);
  const find = useFind({
    search,
    items,
    hasMore,
    loadingOlder,
    loadOlder,
    rows: rowState,
    release,
    scrollToBlock: useCallback(async (key: string) => {
      // The row may only just have been added.
      await new Promise((r) => requestAnimationFrame(r));
      listRef.current
        ?.querySelector(`[data-block="${CSS.escape(key)}"]`)
        ?.scrollIntoView({ block: "center" });
    }, []),
    scroller: useCallback(() => listRef.current, []),
  });
  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
  });
  // ⌘F (Ctrl+F off a Mac) in this chat, or the phone header's search
  // button, opens the find bar; pressed again, the field takes the caret.
  const [findFocus, setFindFocus] = useState(0);
  const showFind = find.show;
  const closeFind = find.close;
  useEffect(() => {
    const open = () => {
      showFind();
      setFindFocus((n) => n + 1);
    };
    const onKey = (e: KeyboardEvent) => {
      const root = rootRef.current;
      const here =
        root?.contains(e.target as Node) ||
        (activeRef.current && e.target === document.body);
      if (!here || !isFindKey(e)) return;
      e.preventDefault();
      open();
    };
    const onFind = (e: Event) => {
      if ((e as CustomEvent<string>).detail === sessionId) open();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener(FIND_EVENT, onFind);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener(FIND_EVENT, onFind);
    };
  }, [sessionId, showFind]);
  // Another conversation starts without the last one's find.
  useEffect(() => closeFind, [sessionId, closeFind]);
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
      data-composer-scope
      className="flex h-full min-h-0 flex-col outline-none"
    >
      {orchestratorOf && <OrchestratorBar workspaceId={orchestratorOf} />}
      <div ref={scrollRef} className="relative min-h-0 flex-1">
        <RowState.Provider value={rowState}>
          <ToolBodies.Provider value={bodies}>
            <div
              // A new conversation starts over, scrolled to the end.
              key={sessionId}
              ref={listRef}
              onScroll={onListScroll}
              onCopy={onCopy}
              className="h-full overflow-y-auto overscroll-y-contain"
            >
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pt-5 pb-4">
                {hasMore && (
                  <div className="text-muted-foreground flex min-h-11 items-center justify-center text-xs">
                    {loadingOlder ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <button
                        type="button"
                        onClick={loadOlder}
                        className="hover:text-foreground min-h-11 px-3"
                      >
                        Show earlier messages
                      </button>
                    )}
                  </div>
                )}
                <SetupCard sessionId={sessionId} />
                {blocks.length === 0 && !queue.length && (
                  <p className="text-muted-foreground py-16 text-center text-sm">
                    Ask anything to start.
                  </p>
                )}
              </div>
              <TimelineRows blocks={blocks} actions={actions} />
            </div>
          </ToolBodies.Provider>
        </RowState.Provider>
        {find.open && (
          <FindBar
            find={find}
            focusKey={findFocus}
            onClose={(fromKey) => {
              closeFind();
              // A tap on a phone would bring up the keyboard over the match.
              if (fromKey || !isMobile) focusComposer();
            }}
          />
        )}
        {unread && !stuck && (
          <button
            type="button"
            onClick={toEnd}
            className="group absolute bottom-1 left-1/2 flex min-h-11 -translate-x-1/2 items-center px-2"
          >
            <span className="bg-background text-foreground group-hover:bg-muted flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium shadow-sm">
              New messages
              <ArrowDown className="h-3.5 w-3.5" />
            </span>
          </button>
        )}
      </div>
      <div className="mx-auto w-full max-w-3xl px-3 pb-3">
        <ActivityLine items={items} state={state} onStop={interrupt} />
        <BackgroundTasks
          items={tasks}
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
        <StaleChip
          context={context}
          state={state}
          thresholdTokens={compactTokens}
          asIs={asIs}
          onAsIs={setAsIs}
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
            toEnd();
            const compact = composerCompacts(text, context, {
              state,
              thresholdTokens: compactTokens,
              asIs,
            });
            setAsIs(false);
            send(text, images.length ? images : undefined, compact);
          }}
          onStop={interrupt}
          commands={commands}
          onRefreshCommands={refreshCommands}
          refreshingCommands={refreshingCommands}
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
          focusKey={active ? sessionId : null}
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
