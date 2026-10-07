/**
 * One live conversation with an agent, as a chat worker runs it: starts the
 * driver, writes every item to SQLite before anyone sees it, and reports
 * events to whoever is connected.
 */

import os from "os";
import { db, type Session } from "../../db";
import { agentEnv } from "../../agents/launch";
import { BUS_BRIEF } from "../../agents/brief";
import { resolveModelForAgent } from "../../model-catalog";
import { chatDriverFor } from "../drivers";
import type { ChatConversation, ChatStartOptions } from "../driver";
import type {
  ChatImage,
  ChatItem,
  ChatState,
  PeerMessage,
  UsageTotals,
} from "../events";
import { listItems, saveItem, settle } from "../store";
import { claimNext, enqueue, listQueue, moveToFront } from "../queued";
import { recordTurn, startingTotals } from "../../usage/turns";
import {
  VISUALS_BRIEF,
  VISUALS_SERVER,
  visualsTools,
} from "../../artifacts/tools";
import type { WorkerCommand, WorkerEvent } from "./protocol";

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
  // A permission mode change still on its way to the agent: a message sent
  // right after it (carrying out a plan) must not overtake it.
  private modeChange: Promise<void> = Promise.resolve();
  readonly done: Promise<void>;

  constructor(
    private session: Session,
    private emit: (e: WorkerEvent) => void,
    // What a session's role adds: its brief and its own tools.
    extras: Pick<
      ChatStartOptions,
      | "systemAppend"
      | "mcpServers"
      | "allowedTools"
      | "disallowedTools"
      | "permissionMode"
    > = {}
  ) {
    this.usage = startingTotals(session.id, !!session.claude_session_id);
    const driver = chatDriverFor(session.agent_type);
    if (!driver)
      throw new Error(`${session.agent_type} sessions can't run as chat yet`);
    const cwd = session.working_directory.replace(/^~/, os.homedir());
    const env = agentEnv(session.id);
    // Every chat can show visuals, asked for like any tool under its access
    // setting (they read files and reach the web). Not an orchestrator: it
    // reads other sessions' text, and a browser would be a way out for it.
    const visuals =
      session.role === "orchestrator"
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
      systemAppend: [extras.systemAppend, BUS_BRIEF, visuals && VISUALS_BRIEF]
        .filter(Boolean)
        .join("\n\n"),
      env,
      mcpServers: visuals
        ? { ...extras.mcpServers, [VISUALS_SERVER]: visuals }
        : extras.mcpServers,
      allowedTools: extras.allowedTools,
      disallowedTools: extras.disallowedTools,
      permissionMode: extras.permissionMode,
    });
    this.suggestion = session.chat_suggestion ?? null;
    // Sends that already made it in, from before a reconnect.
    for (const item of listItems(session.id))
      if (item.kind === "user") this.sent.add(item.id);
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
          if ("streaming" in e.item && e.item.streaming)
            this.streaming.set(e.item.id, e.item);
          else this.streaming.delete(e.item.id);
          this.record(e.item);
        } else if (e.type === "delta") {
          const item = this.streaming.get(e.id);
          if (item && "text" in item) item.text += e.text;
          this.emit(e);
        } else if (e.type === "resume_id") {
          // The agent's own conversation id, so the terminal can resume it
          // too. An undo's resume point is used up once it's back.
          db.prepare(
            `UPDATE sessions SET claude_session_id = ?, chat_resume_at = NULL WHERE id = ?`
          ).run(e.id, this.session.id);
        } else if (e.type === "suggestion") {
          // Kept on the session, so it's still there after a reload.
          this.setSuggestion(e.text);
        } else if (e.type === "usage") {
          this.usage = recordTurn(this.session, this.usage, e.totals);
          this.turnsRecorded++;
        } else if (e.type === "usage_start") {
          // Too late once a turn was measured without it.
          if (!this.turnsRecorded) this.usage = e.totals;
        } else if (e.type === "context") {
          db.prepare(`UPDATE sessions SET chat_context = ? WHERE id = ?`).run(
            JSON.stringify(e.context),
            this.session.id
          );
          this.emit(e);
        } else if (e.type === "state") {
          if (e.state === "idle") {
            // A turn cut off mid-sentence (Esc, Stop) keeps what it streamed.
            this.settleStreaming();
            // The next queued message goes straight on, with no idle in
            // between: the server retires a stale worker the moment it
            // hears one, and would cut that turn off.
            this.state = "idle";
            // A plan-mode or access change on its way goes first.
            await this.modeChange.catch(() => {});
            if (this.sendQueued()) continue;
          }
          // A stopped turn can still settle an approval after it ended.
          if (e.state !== "running" || this.state !== "idle")
            this.setState(e.state);
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

  // Sends the first queued message, if no turn is running. Claimed (taken
  // off the queue) before it's sent, so it can only go once.
  private sendQueued(): boolean {
    if (this.busy() || this.closed) return false;
    const next = claimNext(this.session.id);
    if (!next) return false;
    this.emit({ type: "queue" });
    this.sendUser({ id: next.id, text: next.text, images: next.images });
    return true;
  }

  private sendUser(m: {
    id: string;
    text: string;
    images?: ChatImage[];
    from?: string;
    peer?: PeerMessage;
  }): void {
    this.sent.add(m.id);
    this.currentTurn = m.id;
    const checkpoint = this.conversation.send(m.text, m.images);
    this.record({
      id: m.id,
      kind: "user",
      text: m.text,
      images: m.images,
      from: m.from,
      peer: m.peer,
      createdAt: Date.now(),
      checkpoint,
    });
    this.setState("running");
    // A new turn makes the last guess stale.
    if (this.suggestion !== null) this.setSuggestion(null);
    db.prepare(
      `UPDATE sessions SET updated_at = datetime('now') WHERE id = ?`
    ).run(this.session.id);
  }

  private settleStreaming(): void {
    for (const item of this.streaming.values()) this.record(settle([item])[0]);
    this.streaming.clear();
  }

  async handle(cmd: WorkerCommand): Promise<void> {
    switch (cmd.type) {
      case "send": {
        if (this.sent.has(cmd.id)) return;
        this.sent.add(cmd.id);
        await this.modeChange.catch(() => {});
        const user = {
          id: cmd.id,
          kind: "user" as const,
          text: cmd.text,
          images: cmd.images,
          from: cmd.from,
          peer: cmd.peer,
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
        if (cmd.queue && (this.busy() || listQueue(this.session.id).length)) {
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
        // The turn the reader asked to stop, not one that started since:
        // that one ends on its own, and this goes after it.
        if (this.busy()) {
          if (cmd.during && cmd.during === this.currentTurn)
            return this.conversation.interrupt();
          return;
        }
        await this.modeChange.catch(() => {});
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
      case "close":
        return this.close();
    }
  }

  onClose: () => void = () => {};

  close(): void {
    this.closed = true;
    this.onClose();
    this.conversation.close();
  }
}
