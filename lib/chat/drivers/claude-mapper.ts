import { randomUUID } from "crypto";
import type { ChatCommand, ChatItem, DriverEvent } from "../events";
import { clipOutput, toolDiff, toolTitle } from "../tools";
import { leadingCommand } from "../commands";
import { usageTotals } from "../context";

// Loose views of the SDK's message shapes: only what the mapper reads.
type Block = {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
};
const SYNTHETIC_MODEL = "<synthetic>";

export type ClaudeMessage = {
  type: string;
  subtype?: string;
  session_id?: string;
  uuid?: string;
  message?: { id?: string; model?: string; content?: Block[] | string };
  event?: {
    type: string;
    content_block?: Block;
    delta?: { type: string; text?: string; thinking?: string };
  };
  parent_tool_use_id?: string | null;
  duration_ms?: number;
  num_turns?: number;
  total_cost_usd?: number;
  modelUsage?: Parameters<typeof usageTotals>[0];
  is_error?: boolean;
  errors?: string[];
  result?: string;
  content?: string;
  terminal_slash_commands?: string[];
  commands?: SdkCommand[];
  compact_metadata?: { trigger?: "manual" | "auto" };
  // Background tasks (task_started, task_progress, task_notification).
  task_id?: string;
  tool_use_id?: string;
  description?: string;
  task_type?: string;
  subagent_type?: string;
  status?: "completed" | "failed" | "stopped";
  summary?: string;
  output_file?: string;
  last_tool_name?: string;
  usage?: { tool_uses?: number };
  skip_transcript?: boolean;
  ambient?: boolean;
  // prompt_suggestion: the agent's guess at the next message.
  suggestion?: string;
};

type TaskItem = Extract<ChatItem, { kind: "task" }>;

export type SdkCommand = {
  name: string;
  description?: string;
  argumentHint?: string;
  builtin?: boolean;
};

export function toCommand(c: SdkCommand): ChatCommand {
  return {
    name: c.name,
    description: c.description ?? "",
    argumentHint: c.argumentHint || undefined,
    builtin: c.builtin,
  };
}

const now = () => Date.now();

const INTERRUPT_NOTICE =
  /doesn't want to proceed with this tool use|Request interrupted by user/i;

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) =>
        c && typeof c === "object" && "text" in c ? String(c.text) : ""
      )
      .join("");
  }
  return "";
}

// What a command that printed nothing did, so it never looks ignored.
export function silentCommandText(command: string): string {
  if (command === "/clear")
    return "Context cleared. The agent starts fresh from the next message.";
  return `${command} ran, with nothing to show.`;
}

// Turns Claude Agent SDK messages into provider-neutral chat events.
export class ClaudeMapper {
  private streamingText: ChatItem | null = null;
  private streamingThinking: ChatItem | null = null;
  private tools = new Map<string, Extract<ChatItem, { kind: "tool" }>>();
  private tasks = new Map<string, TaskItem>();
  // The slash command the last message opened with, and whether anything
  // has shown since: a command that answers with nothing still says so.
  private command: string | null = null;
  private shown = false;

  sent(text: string): void {
    this.command = leadingCommand(text);
    this.shown = false;
  }

  map(m: ClaudeMessage): DriverEvent[] {
    const out = this.route(m);
    if (out.some((e) => e.type === "item" || e.type === "delta"))
      this.shown = true;
    return out;
  }

  private route(m: ClaudeMessage): DriverEvent[] {
    // Subagent traffic stays inside its parent tool call.
    if (m.parent_tool_use_id) return [];
    switch (m.type) {
      case "system":
        return this.system(m);
      case "stream_event":
        return this.stream(m);
      case "assistant":
        return this.assistant(m);
      case "user":
        return this.toolResults(m);
      case "result":
        return this.result(m);
      case "prompt_suggestion":
        return m.suggestion?.trim()
          ? [{ type: "suggestion", text: m.suggestion.trim() }]
          : [];
      default:
        return [];
    }
  }

  private pendingText = false;
  private pendingThinking = false;

  private system(m: ClaudeMessage): DriverEvent[] {
    switch (m.subtype) {
      case "init": {
        const out: DriverEvent[] = [];
        if (m.session_id) out.push({ type: "resume_id", id: m.session_id });
        if (m.terminal_slash_commands?.length) {
          out.push({ type: "terminal_only", names: m.terminal_slash_commands });
        }
        return out;
      }
      case "commands_changed":
        return m.commands
          ? [{ type: "commands", commands: m.commands.map(toCommand) }]
          : [];
      case "local_command_output":
        return m.content
          ? [
              {
                type: "item",
                item: {
                  id: randomUUID(),
                  kind: "command_output",
                  text: m.content,
                  createdAt: now(),
                },
              },
            ]
          : [];
      case "task_started":
      case "task_progress":
      case "task_notification":
        return this.task(m);
      case "compact_boundary":
        return [
          {
            type: "item",
            item: {
              id: randomUUID(),
              kind: "compacted",
              trigger: m.compact_metadata?.trigger,
              createdAt: now(),
            },
          },
        ];
      default:
        return [];
    }
  }

  private task(m: ClaudeMessage): DriverEvent[] {
    if (!m.task_id) return [];
    const prev = this.tasks.get(m.task_id);
    const done = m.subtype === "task_notification";
    const item: TaskItem = {
      id: `task-${m.task_id}`,
      kind: "task",
      taskId: m.task_id,
      createdAt: prev?.createdAt ?? now(),
      toolUseId: m.tool_use_id ?? prev?.toolUseId,
      description: m.description || prev?.description || "Background task",
      taskType: m.task_type ?? prev?.taskType,
      subagentType: m.subagent_type ?? prev?.subagentType,
      status: done ? (m.status ?? "completed") : "running",
      endedAt: done ? now() : undefined,
      summary: m.summary ?? prev?.summary,
      outputFile: m.output_file ?? prev?.outputFile,
      toolUses: m.usage?.tool_uses ?? prev?.toolUses,
      lastToolName: m.last_tool_name ?? prev?.lastToolName,
      ambient: !!(m.skip_transcript || m.ambient || prev?.ambient),
    };
    if (done) this.tasks.delete(m.task_id);
    else this.tasks.set(m.task_id, item);
    return [{ type: "item", item }];
  }

  // Items are created on their first text, so blocks that never send any
  // (hidden thinking, empty starts) never show up as empty bubbles.
  private stream(m: ClaudeMessage): DriverEvent[] {
    const e = m.event;
    if (!e) return [];
    if (e.type === "content_block_start") {
      if (e.content_block?.type === "text") this.pendingText = true;
      if (e.content_block?.type === "thinking") this.pendingThinking = true;
      return [];
    }
    if (e.type !== "content_block_delta") return [];
    if (e.delta?.type === "text_delta" && e.delta.text) {
      return this.grow("assistant", e.delta.text);
    }
    if (e.delta?.type === "thinking_delta" && e.delta.thinking) {
      return this.grow("reasoning", e.delta.thinking);
    }
    return [];
  }

  private grow(kind: "assistant" | "reasoning", text: string): DriverEvent[] {
    const current =
      kind === "assistant" ? this.streamingText : this.streamingThinking;
    const pending =
      kind === "assistant" ? this.pendingText : this.pendingThinking;
    if (current && !pending) return [{ type: "delta", id: current.id, text }];
    const item: ChatItem = {
      id: randomUUID(),
      kind,
      text,
      streaming: true,
      createdAt: now(),
    };
    if (kind === "assistant") {
      this.streamingText = item;
      this.pendingText = false;
    } else {
      this.streamingThinking = item;
      this.pendingThinking = false;
    }
    return [{ type: "item", item }];
  }

  private assistant(m: ClaudeMessage): DriverEvent[] {
    const blocks = Array.isArray(m.message?.content) ? m.message.content : [];
    const out: DriverEvent[] = [];
    // The CLI answers local commands (/usage, /context…) with a synthetic
    // message: preformatted text, not model prose.
    const synthetic = m.message?.model === SYNTHETIC_MODEL;
    for (const b of blocks) {
      if (synthetic && b.type === "text" && b.text) {
        out.push({
          type: "item",
          item: {
            id: randomUUID(),
            kind: "command_output",
            text: b.text,
            createdAt: now(),
          },
        });
      } else if (b.type === "text" && b.text) {
        const id = this.streamingText?.id ?? randomUUID();
        out.push({
          type: "item",
          item: { id, kind: "assistant", text: b.text, createdAt: now() },
        });
        this.streamingText = null;
      } else if (b.type === "thinking" && b.thinking) {
        const id = this.streamingThinking?.id ?? randomUUID();
        out.push({
          type: "item",
          item: { id, kind: "reasoning", text: b.thinking, createdAt: now() },
        });
        this.streamingThinking = null;
      } else if (b.type === "tool_use" && b.id && b.name) {
        out.push(...this.toolUse(b.id, b.name, b.input));
      }
    }
    return out;
  }

  private toolUse(id: string, name: string, input: unknown): DriverEvent[] {
    // Shown as its plan card (claude-approvals), not as a step.
    if (name === "ExitPlanMode") return [];
    if (name === "TodoWrite") {
      const todos = (
        (input as { todos?: { content?: string; status?: string }[] })?.todos ??
        []
      ).map((t) => ({
        text: t.content ?? "",
        status:
          (t.status as "pending" | "in_progress" | "completed") ?? "pending",
      }));
      return [
        {
          type: "item",
          item: { id: "todos", kind: "todos", todos, createdAt: now() },
        },
      ];
    }
    const item = {
      id,
      kind: "tool" as const,
      name,
      title: toolTitle(name, input),
      input,
      status: "running" as const,
      diff: toolDiff(name, input),
      createdAt: now(),
    };
    this.tools.set(id, item);
    return [{ type: "item", item }];
  }

  private toolResults(m: ClaudeMessage): DriverEvent[] {
    const blocks = Array.isArray(m.message?.content) ? m.message.content : [];
    const out: DriverEvent[] = [];
    for (const b of blocks) {
      if (b.type !== "tool_result" || !b.tool_use_id) continue;
      const tool = this.tools.get(b.tool_use_id);
      if (!tool) continue;
      const text = resultText(b.content);
      // An interrupt answers the running tool with a notice meant for the
      // model, not the reader.
      const stopped = b.is_error && INTERRUPT_NOTICE.test(text);
      const done = stopped
        ? { ...tool, status: "stopped" as const, output: undefined }
        : {
            ...tool,
            status: b.is_error ? ("error" as const) : ("done" as const),
            output: clipOutput(text),
            endedAt: now(),
          };
      this.tools.delete(b.tool_use_id);
      out.push({ type: "item", item: done });
    }
    return out;
  }

  private result(m: ClaudeMessage): DriverEvent[] {
    const out: DriverEvent[] = [];
    // Tools still open when the turn ends were cut off.
    for (const tool of this.tools.values()) {
      out.push({
        type: "item",
        item: { ...tool, status: "stopped", output: undefined },
      });
    }
    this.tools.clear();
    this.streamingText = this.streamingThinking = null;
    const interrupted = m.subtype === "error_during_execution";
    if (m.is_error && !interrupted) {
      out.push({
        type: "item",
        item: {
          id: randomUUID(),
          kind: "error",
          message: m.errors?.join("\n") || m.result || "The turn failed",
          createdAt: now(),
        },
      });
    }
    const silent = this.command && !this.shown && !m.num_turns && !m.result;
    if (silent && !m.is_error) {
      out.push({
        type: "item",
        item: {
          id: randomUUID(),
          kind: "command_output",
          text: silentCommandText(this.command!),
          createdAt: now(),
        },
      });
    }
    this.command = null;
    out.push({
      type: "item",
      item: {
        id: randomUUID(),
        kind: "turn_end",
        durationMs: m.duration_ms,
        costUsd: m.total_cost_usd,
        interrupted,
        createdAt: now(),
      },
    });
    out.push({
      type: "usage",
      totals: usageTotals(m.modelUsage, m.total_cost_usd),
    });
    out.push({ type: "state", state: "idle" });
    return out;
  }
}
