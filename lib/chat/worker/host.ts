/**
 * One live conversation with an agent, as a chat worker runs it: starts the
 * driver, writes every item to SQLite before anyone sees it, and reports
 * events to whoever is connected.
 */

import os from "os";
import { db, type Session } from "../../db";
import { agentEnv } from "../../agents/launch";
import { sessionRunningBrief } from "../../project-config/session";
import { BUS_BRIEF } from "../../agents/brief";
import { resolveModelForAgent } from "../../model-catalog";
import { chatDriverFor } from "../drivers";
import type { ChatConversation } from "../driver";
import type {
  ChatContext,
  ChatImage,
  ChatItem,
  ChatState,
  SentBy,
  UsageTotals,
} from "../events";
import {
  itemsOfKind,
  moveToEnd,
  runningTools,
  saveItem,
  settle,
} from "../store";
import { claimNext, enqueue, listQueue, moveToFront } from "../queued";
import { isHeld } from "../hold";
import {
  recordCompaction,
  recordTurn,
  startingTotals,
} from "../../usage/turns";
import {
  VISUALS_BRIEF,
  VISUALS_SERVER,
  visualsTools,
} from "../../artifacts/tools";
import type { RoleExtras } from "./extras";
import { compactThreshold, refreshSettings, refreshedNote } from "../refresh";
import { compactContext } from "../compact-context";
import { COMPACT_BRIEF, COMPACT_INSTRUCTIONS } from "../working-state";
import { compactionDue, staleLabel, type Staleness } from "../stale";
import type { WorkerCommand, WorkerEvent } from "./protocol";

// How soon after a stopped turn ends a turn the agent starts on its own
// still counts as part of the stop: the agent starts what it queued the
// moment a turn ends.
const AFTER_STOP_MS = 2000;
// After a hard stop (Stop, the orchestrator's stop, aos stop), how long the
// agent's own wind-down turn is cut short and any sender's message reads as
// the next turn.
const HARD_STOP_MS = 30_000;

// How long a retiring worker waits, once at rest with nothing queued, for
// the agent's guess at the next message before it goes.
export const RETIRE_SUGGESTION_WAIT_MS = 2 * 60 * 1000;
// How long, idle, a message the agent holds may go without starting a turn
// before a retiring worker stops waiting for it (a background task's notice
// the agent never turned into one).
export const RETIRE_REST_WAIT_MS = 30 * 1000;

// What the agent reads, ahead of its next message, in the worker after one
// that retired cleanly (sessions.chat_restarted). Not shown in the chat.
export const RESTARTED_NOTE =
  "(AgentOS was updated and restarted you between turns; your tools changed and are current now.)";

export class ChatHost {
  state: ChatState = "idle";
  readonly streaming = new Map<string, ChatItem>();
  private conversation: ChatConversation;
  private sent = new Set<string>();
  private suggestion: string | null;
  // The user message the running turn began with (or last took in).
  private currentTurn: string | null = null;
  private closed = false;
  // The agent's running totals at its last turn, to tell what the next one
  // cost. It starts from what the agent says it restored; failing that, a
  // resumed conversation's saved totals.
  private usage: UsageTotals | null;
  private turnsRecorded = 0;
  // When the running turn started, for its wall time.
  private turnStartedAt: number | null = null;
  // A permission mode change still on its way to the agent: a message sent
  // right after it (carrying out a plan) must not overtake it.
  private modeChange: Promise<void> = Promise.resolve();
  // Turns the agent said it started, and how many of them have ended.
  private turnsStarted = 0;
  private turnsEnded = 0;
  // A message sent now stops the turns started up to here: their ends
  // aren't idle, since its turn follows straight on. Counted by the turns
  // the agent reports, so one that never started or never sends its result
  // can't swallow the end of the message's own turn.
  private stopsUpTo = 0;
  // Messages sent now whose turn hasn't started: a turn starting while
  // another is still to come is stopped by it, too.
  private nowPending = 0;
  // Those messages: saved at once, and shown (moved after the stopped turn)
  // once it has ended, so they don't read as part of it.
  private handedOver: ChatItem[] = [];
  // Esc stopped the running turn ("turn"), or it has ended ("after", until
  // the next turn ends): a message sent while the stopped turn, or one the
  // agent started on its own straight after it, still runs goes as if sent
  // now. The reader stopped the agent to say something; that's what it
  // should read next.
  private stopping: "turn" | "after" | null = null;
  private stoppedAt = 0;
  private hardStopAt = 0;
  // On an older build than the server's (a "retire"): it closes at the next
  // turn boundary, once the agent holds no message it hasn't run and runs
  // no background work, so a current worker resumes the conversation.
  private retiring = false;
  private retireTimer?: NodeJS.Timeout;
  private retireWaited = false;
  // Messages handed to the agent while a turn ran, and not yet started: it
  // isn't at a boundary while it still holds one.
  private behind = 0;
  private restTimer?: NodeJS.Timeout;
  // Background tasks seen running: one that ends is a notice the agent runs.
  private runningTasks = new Set<string>();
  // Whether its driver says when that is (lib/chat/driver atRest).
  private atRest = true;
  private restartedNote = false;
  private toolsDigest: string | null = null;
  // Its context threshold (lib/chat/refresh): past it, the worker retires
  // at the next turn boundary and ends the agent's conversation, so the
  // next worker starts a new one.
  private refresh: RoleExtras["refresh"];
  private refreshAt = 0;
  // Read ahead of the first message: the last worker started it over.
  private refreshedNote: string | null = null;
  // A conversation this worker starts new: its first reading is what the
  // brief alone costs, and it starts over only once it has grown past that
  // by a quarter of the threshold, so a threshold close to the brief's own
  // size can't end every conversation after one turn.
  private freshConversation: boolean;
  private contextBase: number | null = null;
  // How full the conversation was at its last turn's end (lib/chat/stale).
  private context: ChatContext | null = null;
  // A compaction run ahead of a message (compactFirst): the message waits
  // at the front of the queue until it ends.
  private compacting: {
    // Set when it ran because the chat was stale.
    idleMs?: number;
    before: number;
    done?: boolean;
  } | null = null;
  // Its line, until the agent's next measure gives the size after.
  private compactedLine: Extract<ChatItem, { kind: "compacted" }> | null = null;
  private compactedBy = "threshold";
  // An orchestrator gone stale starts over rather than compacting.
  private staleRefresh: Staleness | null = null;
  readonly done: Promise<void>;

  constructor(
    private session: Session,
    private emit: (e: WorkerEvent) => void,
    // What a session's role adds: its brief and its own tools.
    extras: RoleExtras = {}
  ) {
    this.usage = startingTotals(session.id, !!session.claude_session_id);
    const driver = chatDriverFor(session.agent_type);
    if (!driver)
      throw new Error(`${session.agent_type} sessions can't run as chat yet`);
    // Only the Claude driver runs a role's guard; anything else would skip it.
    if (extras.toolGuard && session.agent_type !== "claude")
      throw new Error(`${session.agent_type} can't enforce this role's tools`);
    this.atRest = driver.atRest !== false;
    const cwd = session.working_directory.replace(/^~/, os.homedir());
    const env = { ...agentEnv(session.id), ...extras.env };
    const orchestrator = session.role === "orchestrator";
    // Every chat can show visuals, asked for like any tool under its access
    // setting (they read files and reach the web). Not an orchestrator: it
    // reads other sessions' text, and a browser would be a way out for it.
    const visuals =
      session.role === "orchestrator" || driver.inProcessTools === false
        ? null
        : visualsTools({
            sessionId: session.id,
            cwd,
            onRender: (artifact, height) =>
              this.record({
                id: `artifact-${artifact.id}`,
                kind: "artifact",
                artifactId: artifact.id,
                title: artifact.title,
                height,
                createdAt: Date.now(),
              }),
          });
    this.conversation = driver.start({
      cwd,
      model:
        session.model?.trim() || resolveModelForAgent(session.agent_type, null),
      resumeId: session.claude_session_id,
      resumeAt: session.chat_resume_at,
      access: session.chat_access ?? "full",
      plan: !!session.chat_plan,
      systemAppend: [
        extras.systemAppend,
        sessionRunningBrief(session.id),
        BUS_BRIEF,
        visuals && VISUALS_BRIEF,
        !orchestrator && COMPACT_BRIEF,
      ]
        .filter(Boolean)
        .join("\n\n"),
      env,
      mcpServers: visuals
        ? { ...extras.mcpServers, [VISUALS_SERVER]: visuals }
        : extras.mcpServers,
      // Claude Code turns tool search off on a non-Anthropic host, so each
      // MCP server the user has adds all its schemas to every prompt
      // (~45k tokens): a routed agent gets only the servers AgentOS gives it.
      strictMcpConfig: !!session.model_provider,
      allowedTools: extras.allowedTools,
      disallowedTools: extras.disallowedTools,
      permissionMode: extras.permissionMode,
      toolGuard: extras.toolGuard,
      // Not an orchestrator: it starts a fresh conversation instead.
      compactContext: orchestrator
        ? undefined
        : () => compactContext(session.id),
    });
    this.suggestion = session.chat_suggestion ?? null;
    try {
      this.context = session.chat_context
        ? (JSON.parse(session.chat_context) as ChatContext)
        : null;
    } catch {
      this.context = null;
    }
    this.refresh = extras.refresh;
    this.freshConversation = !session.claude_session_id;
    if (session.chat_refreshed)
      this.refreshedNote = refreshedNote(
        extras.refresh?.role ??
          (session.role === "orchestrator" ? "orchestrator" : "task"),
        session.chat_refreshed
      );
    // Told only an orchestrator whose tools changed since its last worker:
    // that's what the note is for. Anything else just clears the mark.
    this.toolsDigest = extras.toolsDigest ?? null;
    this.restartedNote =
      !!session.chat_restarted &&
      this.toolsDigest !== null &&
      this.toolsDigest !== (session.chat_tools_digest ?? null);
    if (!this.restartedNote)
      db.prepare(
        `UPDATE sessions SET chat_restarted = 0, chat_tools_digest = ? WHERE id = ?`
      ).run(this.toolsDigest, session.id);
    // Sends that already made it in, from before a reconnect.
    for (const item of itemsOfKind(session.id, "user")) this.sent.add(item.id);
    // Nothing runs yet in a worker just started: a tool call still saved as
    // running was cut off with the last one.
    this.closeTools();
    this.done = this.pump();
  }

  private record(item: ChatItem): void {
    saveItem(this.session.id, item);
    this.emit({ type: "item", item });
  }

  private setState(state: ChatState): void {
    this.state = state;
    this.emit({ type: "state", state });
  }

  private async pump(): Promise<void> {
    try {
      for await (const e of this.conversation.events) {
        if (e.type === "item") {
          // A compaction run for a stale chat shows as its one line; what
          // a failed one printed still shows.
          if (this.compacting?.done && e.item.kind === "command_output")
            continue;
          if (e.item.kind === "compacted") {
            if (this.compacting) e.item = this.compactedItem(e.item);
            else this.logCompacted(e.item, e.item.trigger ?? "manual");
          }
          if ("streaming" in e.item && e.item.streaming)
            this.streaming.set(e.item.id, e.item);
          else this.streaming.delete(e.item.id);
          this.record(e.item);
          if (e.item.kind === "task" && !e.item.ambient) {
            if (e.item.status === "running")
              this.runningTasks.add(e.item.taskId);
            else if (this.runningTasks.delete(e.item.taskId)) this.behind++;
            this.retireIfDone();
          }
        } else if (e.type === "delta") {
          const item = this.streaming.get(e.id);
          if (item && "text" in item) item.text += e.text;
          this.emit(e);
        } else if (e.type === "resume_id") {
          // The agent's own conversation id, so the terminal can resume it
          // too. An undo's resume point is used up once it's back. Not
          // once closed: a conversation ended at its threshold stays ended.
          if (this.closed) continue;
          db.prepare(
            `UPDATE sessions SET claude_session_id = ?, chat_resume_at = NULL WHERE id = ?`
          ).run(e.id, this.session.id);
        } else if (e.type === "suggestion") {
          // Kept on the session, so it's still there after a reload.
          this.setSuggestion(e.text);
          this.retireIfDone();
        } else if (e.type === "usage") {
          const at = Date.now();
          this.usage = recordTurn(
            this.session,
            this.usage,
            e.totals,
            at,
            this.turnStartedAt === null ? null : at - this.turnStartedAt
          );
          this.turnStartedAt = null;
          this.turnsRecorded++;
        } else if (e.type === "usage_start") {
          // Too late once a turn was measured without it.
          if (!this.turnsRecorded) this.usage = e.totals;
        } else if (e.type === "context") {
          db.prepare(`UPDATE sessions SET chat_context = ? WHERE id = ?`).run(
            JSON.stringify(e.context),
            this.session.id
          );
          this.context = e.context;
          this.emit(e);
          this.settleCompactedLine(e.context.usedTokens);
          this.refreshIfFull(e.context.usedTokens);
        } else if (e.type === "turn_start") {
          // The agent starting a turn of its own right after a hard stop
          // (the CLI winds down with a reply to the interruption) is cut
          // short, so what's sent next isn't queued behind it.
          if (this.hardStopped()) void this.conversation.interrupt();
          this.turnsStarted++;
          this.turnStartedAt ??= Date.now();
          if (this.behind) this.behind--;
          clearTimeout(this.restTimer);
          this.restTimer = undefined;
          if (this.nowPending && --this.nowPending)
            this.stopsUpTo = this.turnsStarted;
          // A turn the agent started itself (a background task's notice)
          // runs like any other: what's sent meanwhile waits for it.
          if (this.state === "idle" && !this.closed) {
            // Only straight after a stop is it the stop's aftermath.
            if (Date.now() - this.stoppedAt > AFTER_STOP_MS)
              this.stopping = null;
            this.currentTurn = null;
            this.setState("running");
          }
        } else if (e.type === "state") {
          if (e.state === "idle") {
            // A turn cut off mid-sentence (Esc, Stop) keeps what it streamed.
            this.settleStreaming();
            this.closeTools();
            this.stopping = this.stopping === "turn" ? "after" : null;
            this.stoppedAt = Date.now();
            let stoppedTurn = false;
            if (this.turnsEnded < this.turnsStarted)
              stoppedTurn = ++this.turnsEnded <= this.stopsUpTo;
            // The message sent now is already the agent's next turn.
            if (stoppedTurn) {
              if (this.turnsEnded === this.stopsUpTo) this.showHandedOver();
              continue;
            }
            this.nowPending = 0;
            if (!this.atRest) this.behind = 0;
            // The next queued message goes straight on, with no idle in
            // between: the server retires a stale worker the moment it
            // hears one, and would cut that turn off.
            this.state = "idle";
            // A plan-mode or access change on its way goes first.
            await this.modeChange.catch(() => {});
            // A send waiting on the same change may have started a turn
            // meanwhile: that turn is running, not idle.
            if (this.busy()) continue;
            // The compaction ran (or failed): its message is first in line.
            this.compacting = null;
            if (this.sendQueued()) continue;
          }
          // A stopped turn can still settle an approval after it ended.
          if (e.state !== "running" || this.state !== "idle")
            this.setState(e.state);
          this.retireIfDone();
        } else if (e.type === "at_rest") {
          // Every message it was given has run, those it took in mid-turn
          // too.
          this.behind = 0;
          this.retireIfDone();
        } else {
          this.emit(e);
        }
      }
    } catch (error) {
      this.record({
        id: `error-${Date.now()}`,
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
        createdAt: Date.now(),
      });
    } finally {
      this.settleStreaming();
      this.closeTools();
      this.showHandedOver();
      this.setState("idle");
    }
  }

  private setSuggestion(text: string | null): void {
    this.suggestion = text;
    db.prepare(`UPDATE sessions SET chat_suggestion = ? WHERE id = ?`).run(
      text,
      this.session.id
    );
    this.emit({ type: "suggestion", text });
  }

  private busy(): boolean {
    return this.state === "running" || this.state === "waiting";
  }

  // Sends the first queued message (or that one), if no turn is running or
  // it's sent now. Claimed (taken off the queue) before it's sent, so it can
  // only go once.
  private sendQueued(now = false, id?: string): boolean {
    if ((!now && this.busy()) || this.closed || this.handingOver())
      return false;
    const next = claimNext(this.session.id, id);
    if (!next) return false;
    this.emit({ type: "queue" });
    this.sendUser(next, now);
    return true;
  }

  private sendUser(
    m: {
      id: string;
      text: string;
      images?: ChatImage[];
    } & SentBy,
    now = false
  ): void {
    this.sent.add(m.id);
    this.currentTurn = m.id;
    this.hardStopAt = 0;
    if (this.busy()) this.behind++;
    // Sent now, it stops the running turn, which still ends after this.
    if (!this.busy()) now = false;
    // A turn the agent has started and not ended is what stops.
    const handOver = now && this.turnsStarted > this.turnsEnded;
    if (handOver) this.stopsUpTo = this.turnsStarted;
    if (now) this.nowPending++;
    this.stopping = null;
    const note = this.refreshedNote ?? (this.restartedNote && RESTARTED_NOTE);
    const text = note ? `${note}\n\n${m.text}` : m.text;
    if (this.refreshedNote) {
      this.refreshedNote = null;
      db.prepare(`UPDATE sessions SET chat_refreshed = 0 WHERE id = ?`).run(
        this.session.id
      );
    }
    if (this.restartedNote) {
      this.restartedNote = false;
      db.prepare(
        `UPDATE sessions SET chat_restarted = 0, chat_tools_digest = ? WHERE id = ?`
      ).run(this.toolsDigest, this.session.id);
    }
    const checkpoint = now
      ? this.conversation.send(text, m.images, { now })
      : this.conversation.send(text, m.images);
    const user: ChatItem = {
      id: m.id,
      kind: "user",
      text: m.text,
      images: m.images,
      from: m.from,
      peer: m.peer,
      origin: m.origin,
      tagged: true as const,
      createdAt: Date.now(),
      checkpoint,
    };
    if (handOver) {
      saveItem(this.session.id, user);
      this.handedOver.push(user);
    } else this.record(user);
    this.setState("running");
    // A new turn makes the last guess stale.
    if (this.suggestion !== null) this.setSuggestion(null);
    db.prepare(
      `UPDATE sessions SET updated_at = datetime('now') WHERE id = ?`
    ).run(this.session.id);
  }

  private showHandedOver(): void {
    for (const user of this.handedOver.splice(0)) {
      moveToEnd(this.session.id, user.id);
      this.emit({ type: "item", item: user });
    }
  }

  // At a turn's end nothing is running: a tool call with no result was cut
  // off (by a stop, or a worker before this one).
  private closeTools(): void {
    for (const tool of runningTools(this.session.id))
      if (!this.streaming.has(tool.id))
        this.record({ ...tool, status: "stopped", output: undefined });
  }

  private settleStreaming(): void {
    for (const item of this.streaming.values()) this.record(settle([item])[0]);
    this.streaming.clear();
  }

  async handle(cmd: WorkerCommand): Promise<void> {
    switch (cmd.type) {
      case "send": {
        if (this.sent.has(cmd.id)) return;
        // Sent just as a move or Land took hold (lib/chat/hold): it waits
        // in the queue rather than start a turn the stop would cut short.
        // Or for the current worker that takes over from a retiring one.
        const held = isHeld(this.session.id);
        if (held || this.handingOver()) {
          try {
            enqueue(this.session.id, cmd);
            this.emit({ type: "queue" });
            this.retireIfDone();
            return;
          } catch (error) {
            // A full queue can't lose it: retiring, the agent takes it as
            // before, and the worker goes at a later boundary.
            if (held) throw error;
          }
        }
        this.sent.add(cmd.id);
        await this.modeChange.catch(() => {});
        const user = {
          id: cmd.id,
          kind: "user" as const,
          text: cmd.text,
          images: cmd.images,
          from: cmd.from,
          peer: cmd.peer,
          origin: cmd.origin,
          tagged: true as const,
          createdAt: Date.now(),
        };
        const local = cmd.images?.length
          ? null
          : this.conversation.runLocal?.(cmd.text);
        if (local) {
          // Answered on the spot: no turn starts, and one running goes on.
          this.record(user);
          try {
            for (const item of await local) this.record(item);
          } catch (error) {
            this.record({
              id: `error-${Date.now()}`,
              kind: "error",
              message: error instanceof Error ? error.message : String(error),
              createdAt: Date.now(),
            });
          }
          return;
        }
        // Typed after Esc, while the stopped turn winds down or the agent
        // starts on something it queued itself: read next, as if sent now.
        // Another agent's message doesn't speak for the reader.
        if (
          this.stopping &&
          (this.hardStopped() || (!cmd.from && !cmd.peer && !cmd.origin)) &&
          this.busy() &&
          !listQueue(this.session.id).length
        ) {
          this.sendUser(cmd, true);
          return;
        }
        if (this.compactFirst(cmd)) return;
        // A compaction run for an earlier message takes nothing in: what's
        // sent meanwhile goes behind that message.
        if (
          (cmd.queue || this.compacting) &&
          (this.busy() || listQueue(this.session.id).length)
        ) {
          // Behind the running turn, and behind anything queued before it.
          enqueue(this.session.id, cmd);
          this.emit({ type: "queue" });
          this.sendQueued();
          return;
        }
        this.sendUser(cmd);
        return;
      }
      case "send_now":
        // To the front; a running turn stops, and its end sends it.
        if (!moveToFront(this.session.id, cmd.id)) return;
        this.emit({ type: "queue" });
        await this.modeChange.catch(() => {});
        // The turn the reader asked to stop, not one that started since:
        // that one ends on its own, and this goes after it.
        if (this.busy()) {
          if (cmd.during && cmd.during === this.currentTurn) {
            // Retiring, the turn just stops; the next worker sends it.
            if (this.handingOver()) return this.conversation.interrupt();
            this.sendQueued(true, cmd.id);
          }
          return;
        }
        this.sendQueued();
        return;
      case "drain":
        await this.modeChange.catch(() => {});
        this.sendQueued();
        return;
      case "files":
        try {
          const files = this.conversation.fileSuggestions
            ? await this.conversation.fileSuggestions(cmd.query)
            : undefined;
          this.emit({ type: "files_result", reqId: cmd.reqId, files });
        } catch (error) {
          this.emit({
            type: "files_result",
            reqId: cmd.reqId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      case "interrupt":
        await this.modeChange.catch(() => {});
        if (cmd.hard) {
          this.hardStopAt = Date.now();
          this.behind = 0;
          this.stopping = "turn";
          return this.conversation.interrupt();
        }
        if (!this.busy()) return this.conversation.interrupt();
        // What's queued goes on once the turn stops: it goes with the stop,
        // so it's what the agent reads next.
        if (this.sendQueued(true)) return;
        this.stopping = "turn";
        return this.conversation.interrupt();
      case "set_model":
        return this.conversation.setModel(cmd.model);
      case "set_access":
        return (this.modeChange = this.conversation.setAccess(cmd.access));
      case "set_plan":
        return (this.modeChange = this.conversation.setPlan(cmd.plan));
      case "respond":
        return this.conversation.respond(cmd.id, cmd);
      case "stop_task":
        return this.conversation.stopTask(cmd.taskId);
      case "undo":
        try {
          const result = await this.conversation.undo(
            cmd.checkpoint,
            cmd.dryRun
          );
          this.emit({ type: "undo_result", reqId: cmd.reqId, result });
        } catch (error) {
          this.emit({
            type: "undo_result",
            reqId: cmd.reqId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      case "retire":
        this.retiring = true;
        return this.retireIfDone();
      case "close":
        return this.close();
    }
  }

  private hardStopped(): boolean {
    return this.hardStopAt > 0 && Date.now() - this.hardStopAt < HARD_STOP_MS;
  }

  // A retiring worker goes once it's at a turn boundary: no turn running,
  // no message handed to the agent still to run, no background work (it
  // lives in the agent, and would be lost). With nothing queued it first
  // waits a while for the agent's guess at the next message.
  private retireIfDone(): void {
    if (!this.handingOver() || this.closed || this.busy()) return;
    if (this.behind) {
      this.restTimer ??= setTimeout(() => {
        this.restTimer = undefined;
        this.behind = 0;
        this.retireIfDone();
      }, RETIRE_REST_WAIT_MS);
      return;
    }
    const queued = listQueue(this.session.id).length > 0;
    if (!queued && this.suggestion === null && !this.retireWaited) {
      this.retireTimer ??= setTimeout(() => {
        this.retireWaited = true;
        this.retireIfDone();
      }, RETIRE_SUGGESTION_WAIT_MS);
      return;
    }
    if (this.refreshAt) this.endConversation();
    // Retired cleanly (a crash sets nothing): the next worker says so.
    else
      db.prepare(`UPDATE sessions SET chat_restarted = 1 WHERE id = ?`).run(
        this.session.id
      );
    this.close();
  }

  // A chat over the compact threshold or stale (lib/chat/stale) is
  // compacted before the message goes in, only between turns: the message
  // waits at the front of the queue, and the compaction's end sends it.
  // "yes" is the reader's choice, made on what the composer showed; "auto"
  // checks for itself.
  private compactFirst(cmd: Extract<WorkerCommand, { type: "send" }>): boolean {
    if (!cmd.compact || this.busy() || this.closed || this.handingOver())
      return false;
    const stale = this.staleNow(cmd.compact);
    // An orchestrator starts over at its own threshold (lib/chat/refresh);
    // only one gone stale does it early.
    if (!stale || (this.session.role === "orchestrator" && !stale.stale))
      return false;
    try {
      enqueue(this.session.id, cmd);
    } catch {
      // A full queue: it goes in as it is.
      return false;
    }
    moveToFront(this.session.id, cmd.id);
    this.emit({ type: "queue" });
    // An orchestrator isn't compacted: a summary would carry what it read
    // from tasks and CI without its untrusted fence. It starts a fresh
    // conversation from its brief and the database instead, as at its
    // threshold, and the next worker sends the message.
    if (this.session.role === "orchestrator") {
      this.staleRefresh = stale;
      this.refreshAt = stale.tokens;
      this.retiring = true;
      this.retireWaited = true;
      this.retireIfDone();
      return true;
    }
    this.compacting = {
      idleMs: stale.stale ? stale.idleMs : undefined,
      before: stale.tokens,
    };
    this.currentTurn = null;
    this.stopping = null;
    this.conversation.send(`/compact ${COMPACT_INSTRUCTIONS}`);
    this.setState("running");
    console.error(
      `${new Date().toISOString()} compacting ${this.session.id} before a message: ${stale.stale ? `idle ${Math.round(stale.idleMs / 60_000)}m, ` : ""}${stale.tokens} tokens`
    );
    return true;
  }

  private staleNow(compact: "auto" | "yes"): Staleness | null {
    const context = this.context;
    // Only an agent that says which cache it uses has one to lose.
    if (!context?.cacheTtlMs) return null;
    if (compact === "yes") {
      const idleMs = Date.now() - context.at;
      return {
        idleMs,
        tokens: context.usedTokens,
        stale: idleMs > context.cacheTtlMs,
      };
    }
    return compactionDue(context, {
      state: this.state,
      thresholdTokens: compactThreshold(
        refreshSettings().compactTokens,
        this.session.model_provider
      ),
    });
  }

  private compactedItem(
    item: Extract<ChatItem, { kind: "compacted" }>
  ): ChatItem {
    if (this.compacting) this.compacting.done = true;
    const line = {
      ...item,
      idleMs: this.compacting?.idleMs,
      before: item.before ?? this.compacting?.before,
    };
    this.compactedBy = line.idleMs !== undefined ? "stale" : "threshold";
    this.compactedLine = line.after === undefined ? line : null;
    if (line.after !== undefined) this.logCompacted(line, this.compactedBy);
    return line;
  }

  // The size after, from the measure that follows the compaction's result.
  private settleCompactedLine(usedTokens: number): void {
    const line = this.compactedLine;
    if (!line) return;
    this.compactedLine = null;
    const settled = { ...line, after: usedTokens };
    this.record(settled);
    this.logCompacted(settled, this.compactedBy);
  }

  // Logged, and kept for the usage history (lib/usage/turns).
  private logCompacted(
    line: { before?: number; after?: number },
    trigger: string
  ): void {
    console.error(
      `${new Date().toISOString()} compacted ${this.session.id} (${trigger}): ${line.before ?? "?"} -> ${line.after ?? "?"} tokens`
    );
    try {
      recordCompaction(this.session, {
        trigger,
        before: line.before,
        after: line.after,
      });
    } catch (e) {
      console.error(`recording ${this.session.id}'s compaction:`, e);
    }
  }

  // Past its threshold, once: it retires at the next turn boundary, as for
  // a deploy, without waiting for the agent's guess at the next message
  // (the new conversation never saw what it guessed from).
  private refreshIfFull(usedTokens: number): void {
    const at = this.refresh?.atTokens ?? 0;
    if (this.freshConversation) this.contextBase ??= usedTokens;
    if (this.refreshAt || at <= 0 || usedTokens < at) return;
    if (usedTokens - (this.contextBase ?? 0) < at / 4) return;
    this.refreshAt = usedTokens;
    this.retiring = true;
    this.retireWaited = true;
    this.retireIfDone();
  }

  // The agent's conversation is let go: the next worker starts a new one
  // with the brief and tells it why. The chat Saad reads goes on, with a
  // line saying where it started over.
  private endConversation(): void {
    db.prepare(
      `UPDATE sessions SET claude_session_id = NULL, chat_resume_at = NULL,
         chat_suggestion = NULL, chat_context = NULL, chat_restarted = 0,
         chat_refreshed = ? WHERE id = ?`
    ).run(this.refreshAt, this.session.id);
    const brief = `its brief${this.session.role === "orchestrator" ? " and the current state from AgentOS" : ""}`;
    const stale = this.staleRefresh;
    this.record({
      id: `note-refresh-${Date.now()}`,
      kind: "note",
      tone: "note",
      text: stale
        ? `${staleLabel(stale)}, past its prompt cache: the agent starts a fresh conversation with ${brief} before the next message.`
        : `Context reached ${Math.round(this.refreshAt / 1000)}k tokens: the agent starts a fresh conversation with ${brief} at its next message.`,
      createdAt: Date.now(),
    });
    if (stale)
      console.error(
        `${new Date().toISOString()} fresh start for stale ${this.session.id}: ${stale.tokens} tokens, idle ${Math.round(stale.idleMs / 60_000)}m`
      );
  }

  // Retiring, and nothing in the background keeps it: messages wait in the
  // queue for the next worker. While background work runs (it can run for
  // as long as a dev server does) the worker carries on as usual.
  private handingOver(): boolean {
    return this.retiring && this.runningTasks.size === 0;
  }

  onClose: () => void = () => {};

  close(): void {
    clearTimeout(this.retireTimer);
    clearTimeout(this.restTimer);
    this.closed = true;
    this.onClose();
    this.conversation.close();
  }
}
