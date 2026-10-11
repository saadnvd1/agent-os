import { describe, expect, it } from "vitest";
import type { ChatItem } from "./events";
import { editedFiles, workingStateNote } from "./working-state";

type Tool = Extract<ChatItem, { kind: "tool" }>;

const tool = (
  name: string,
  input: unknown,
  over: Partial<Tool> = {}
): Tool => ({
  id: `${name}-${Math.random()}`,
  createdAt: 0,
  kind: "tool",
  name,
  title: name,
  input,
  status: "done",
  ...over,
});

describe("editedFiles", () => {
  it("lists edited paths newest first, once each, skipping reads and failures", () => {
    const files = editedFiles([
      tool("Write", { file_path: "/w/a.ts" }),
      tool("Read", { file_path: "/w/read.ts" }),
      tool("Edit", { file_path: "/w/b.ts" }),
      tool("Edit", { file_path: "/w/bad.ts" }, { status: "error" }),
      tool("Edit", { file_path: "/w/a.ts" }),
      tool("NotebookEdit", { notebook_path: "/w/n.ipynb" }),
    ]);
    expect(files).toEqual(["/w/n.ipynb", "/w/a.ts", "/w/b.ts"]);
  });

  it("keeps at most 20", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      tool("Edit", { file_path: `/w/f${i}.ts` })
    );
    expect(editedFiles(many)).toHaveLength(20);
  });
});

describe("workingStateNote", () => {
  it("carries the brief, scope changes, files, todos and the next step", () => {
    const note = workingStateNote({
      taskPrompt: "Add a rate limiter to the API",
      amendments: ["Also cover the websocket route", "Skip the docs"],
      tools: [tool("Edit", { file_path: "/w/limiter.ts" })],
      todos: [
        { text: "write limiter", status: "completed" },
        { text: "wire middleware", status: "in_progress" },
        { text: "add tests", status: "pending" },
      ],
      requests: ["Add a rate limiter to the API", "use the token bucket"],
      gitStatus: " M limiter.ts",
    });
    expect(note).toContain("Add a rate limiter to the API");
    expect(note).toMatch(
      /1\. Also cover the websocket route\n2\. Skip the docs/
    );
    expect(note).toContain("- /w/limiter.ts");
    expect(note).toContain("- [done] write limiter");
    expect(note).toContain("- [in progress] wire middleware");
    expect(note).toContain("- [next] add tests");
    expect(note).toContain("use the token bucket");
    expect(note).toContain("M limiter.ts");
    expect(note).toContain("Carry on from the next step");
    // The task prompt isn't repeated as a reader message.
    expect(note.match(/Add a rate limiter to the API/g)).toHaveLength(1);
  });

  it("is empty with nothing to say, and omits empty sections", () => {
    expect(workingStateNote({})).toBe("");
    const note = workingStateNote({ taskPrompt: "do x" });
    expect(note).not.toContain("Scope changes");
    expect(note).not.toContain("Files you were editing");
  });

  it("stays under its cap", () => {
    const note = workingStateNote({
      taskPrompt: "x".repeat(50_000),
      amendments: Array.from({ length: 50 }, () => "y".repeat(5_000)),
    });
    expect(note.length).toBeLessThan(12_100);
  });
});
