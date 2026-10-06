import { describe, it, expect } from "vitest";
import { ClaudeMapper } from "./claude-mapper";
import type { ChatItem, DriverEvent } from "../events";

const items = (events: DriverEvent[]) =>
  events
    .filter((e): e is { type: "item"; item: ChatItem } => e.type === "item")
    .map((e) => e.item);

describe("ClaudeMapper", () => {
  it("reports the conversation id from init", () => {
    expect(
      new ClaudeMapper().map({
        type: "system",
        subtype: "init",
        session_id: "s1",
      })
    ).toEqual([{ type: "resume_id", id: "s1" }]);
  });

  it("streams text into one item and finalises it with the full message", () => {
    const m = new ClaudeMapper();
    expect(
      m.map({
        type: "stream_event",
        event: { type: "content_block_start", content_block: { type: "text" } },
      })
    ).toEqual([]);
    const [start] = items(
      m.map({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "Hel" },
        },
      })
    );
    expect(start).toMatchObject({
      kind: "assistant",
      text: "Hel",
      streaming: true,
    });
    const delta = m.map({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "lo" },
      },
    });
    expect(delta).toEqual([{ type: "delta", id: start.id, text: "lo" }]);
    const [final] = items(
      m.map({
        type: "assistant",
        message: { content: [{ type: "text", text: "Hello" }] },
      })
    );
    expect(final).toMatchObject({
      id: start.id,
      kind: "assistant",
      text: "Hello",
    });
  });

  it("never creates an item for a block that sends no text", () => {
    const m = new ClaudeMapper();
    m.map({
      type: "stream_event",
      event: {
        type: "content_block_start",
        content_block: { type: "thinking" },
      },
    });
    expect(
      m.map({
        type: "assistant",
        message: { content: [{ type: "thinking", thinking: "" }] },
      })
    ).toEqual([]);
  });

  it("tracks a tool call from use to result, with a diff for edits", () => {
    const m = new ClaudeMapper();
    const [running] = items(
      m.map({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "t1",
              name: "Edit",
              input: {
                file_path: "/a/b/c.ts",
                old_string: "x",
                new_string: "y",
              },
            },
          ],
        },
      })
    );
    expect(running).toMatchObject({
      kind: "tool",
      status: "running",
      title: "Edit b/c.ts",
      diff: { before: "x", after: "y" },
    });
    const [done] = items(
      m.map({
        type: "user",
        message: {
          content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }],
        },
      })
    );
    expect(done).toMatchObject({ id: "t1", status: "done", output: "ok" });
  });

  it("turns TodoWrite into a todo list", () => {
    const [todos] = items(
      new ClaudeMapper().map({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "t2",
              name: "TodoWrite",
              input: { todos: [{ content: "Ship", status: "in_progress" }] },
            },
          ],
        },
      })
    );
    expect(todos).toMatchObject({
      kind: "todos",
      todos: [{ text: "Ship", status: "in_progress" }],
    });
  });

  it("ends the turn, closing tools that were cut off", () => {
    const m = new ClaudeMapper();
    m.map({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "t3",
            name: "Bash",
            input: { command: "sleep 9" },
          },
        ],
      },
    });
    const events = m.map({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      duration_ms: 50,
    });
    const out = items(events);
    expect(out[0]).toMatchObject({ id: "t3", status: "stopped" });
    expect(out.at(-1)).toMatchObject({ kind: "turn_end", interrupted: true });
    expect(events.at(-1)).toEqual({ type: "state", state: "idle" });
  });

  it("shows an interrupted tool as stopped, not the model-facing notice", () => {
    const m = new ClaudeMapper();
    m.map({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "t4",
            name: "Bash",
            input: { command: "sleep 9" },
          },
        ],
      },
    });
    const [stopped] = items(
      m.map({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "t4",
              is_error: true,
              content:
                "The user doesn't want to proceed with this tool use. The tool use was rejected. STOP what you are doing.",
            },
          ],
        },
      })
    );
    expect(stopped).toMatchObject({ status: "stopped", output: undefined });
  });

  it("ignores subagent traffic", () => {
    expect(
      new ClaudeMapper().map({
        type: "assistant",
        parent_tool_use_id: "x",
        message: { content: [{ type: "text", text: "hi" }] },
      })
    ).toEqual([]);
  });

  it("shows a command's own output and marks compaction", () => {
    const m = new ClaudeMapper();
    const [out] = items(
      m.map({
        type: "system",
        subtype: "local_command_output",
        content: "Total cost: $1.20",
      })
    );
    expect(out).toMatchObject({
      kind: "command_output",
      text: "Total cost: $1.20",
    });
    const [compacted] = items(
      m.map({
        type: "system",
        subtype: "compact_boundary",
        compact_metadata: { trigger: "manual" },
      })
    );
    expect(compacted).toMatchObject({ kind: "compacted", trigger: "manual" });
  });

  it("shows a synthetic reply to a local command as command output", () => {
    const [out] = items(
      new ClaudeMapper().map({
        type: "assistant",
        message: {
          model: "<synthetic>",
          content: [
            { type: "text", text: "Current session: 13% used\n  Top skills" },
          ],
        },
      })
    );
    expect(out).toMatchObject({
      kind: "command_output",
      text: "Current session: 13% used\n  Top skills",
    });
  });

  it("reports command list changes and terminal-only commands", () => {
    const m = new ClaudeMapper();
    expect(
      m.map({
        type: "system",
        subtype: "commands_changed",
        commands: [{ name: "ship", description: "Ship it", argumentHint: "" }],
      })
    ).toEqual([
      {
        type: "commands",
        commands: [
          {
            name: "ship",
            description: "Ship it",
            argumentHint: undefined,
            builtin: undefined,
          },
        ],
      },
    ]);
    expect(
      m.map({
        type: "system",
        subtype: "init",
        session_id: "s",
        terminal_slash_commands: ["statusline"],
      })
    ).toEqual([
      { type: "resume_id", id: "s" },
      { type: "terminal_only", names: ["statusline"] },
    ]);
  });

  it("titles a skill call by the skill's name", () => {
    const [skill] = items(
      new ClaudeMapper().map({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "t9",
              name: "Skill",
              input: { skill: "ship" },
            },
          ],
        },
      })
    );
    expect(skill).toMatchObject({ name: "Skill", title: "Skill: ship" });
  });
});

describe("ClaudeMapper background tasks", () => {
  it("follows a task from start to finish as one item", () => {
    const m = new ClaudeMapper();
    const [started] = items(
      m.map({
        type: "system",
        subtype: "task_started",
        task_id: "b1",
        tool_use_id: "t1",
        description: "Watch the deploy",
        task_type: "local_bash",
      })
    );
    expect(started).toMatchObject({
      id: "task-b1",
      kind: "task",
      status: "running",
      description: "Watch the deploy",
    });
    const [progress] = items(
      m.map({
        type: "system",
        subtype: "task_progress",
        task_id: "b1",
        description: "",
        usage: { tool_uses: 3 },
      })
    );
    expect(progress).toMatchObject({
      description: "Watch the deploy",
      toolUses: 3,
      createdAt: started.createdAt,
    });
    const [done] = items(
      m.map({
        type: "system",
        subtype: "task_notification",
        task_id: "b1",
        status: "failed",
        output_file: "/tmp/b1.output",
        summary: "exit 1",
      })
    );
    expect(done).toMatchObject({
      id: "task-b1",
      status: "failed",
      outputFile: "/tmp/b1.output",
      summary: "exit 1",
    });
    expect((done as { endedAt?: number }).endedAt).toBeTypeOf("number");
  });

  it("titles a command by the agent's own description", () => {
    const [tool] = items(
      new ClaudeMapper().map({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "t2",
              name: "Bash",
              input: { command: "npm test", description: "Run the tests" },
            },
          ],
        },
      })
    );
    expect(tool).toMatchObject({ title: "Run the tests" });
  });
});
