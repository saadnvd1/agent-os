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
import type { ChatItem, ChatState } from "../events";
import { listItems, saveItem, settle } from "../store";
import { recordTurn } from "../../usage/turns";
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
        } else if (e.type === "usage") {
          recordTurn(this.session, e.totals);
        } else if (e.type === "context") {
          db.prepare(`UPDATE sessions SET chat_context = ? WHERE id = ?`).run(
            JSON.stringify(e.context),
            this.session.id
          );
          this.emit(e);
        } else if (e.type === "state") {
          // A turn cut off mid-sentence (Esc, Stop) keeps what it streamed.
          if (e.state === "idle") this.settleStreaming();
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
        const checkpoint = this.conversation.send(cmd.text, cmd.images);
        this.record({ ...user, checkpoint });
        this.setState("running");
        db.prepare(
          `UPDATE sessions SET updated_at = datetime('now') WHERE id = ?`
        ).run(this.session.id);
        return;
      }
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
    this.onClose();
    this.conversation.close();
  }
}
