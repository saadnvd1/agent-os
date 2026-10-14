import { describe, expect, it } from "vitest";
import { planFromTranscript } from "./plan";

const use = (name: string, input: object) =>
  JSON.stringify({
    type: "assistant",
    message: {
      content: [
        { type: "text", text: "ok" },
        { type: "tool_use", name, input },
      ],
    },
  });
const FILE = "/work/tree/.agentos/plan.md";

describe("planFromTranscript", () => {
  it("reads the plan from the Write", () => {
    expect(
      planFromTranscript(use("Write", { file_path: FILE, content: "# P\n" }))
    ).toBe("# P\n");
  });

  it("replays the Edits made after it, in order", () => {
    const text = [
      use("Write", { file_path: FILE, content: "a b c\n" }),
      use("Edit", { file_path: FILE, old_string: "b", new_string: "B" }),
      use("Edit", { file_path: FILE, old_string: "B c", new_string: "done" }),
    ].join("\n");
    expect(planFromTranscript(text)).toBe("a done\n");
  });

  it("skips an Edit that no longer applies, and other files", () => {
    const text = [
      use("Write", { file_path: "/work/tree/src/x.ts", content: "nope" }),
      use("Write", { file_path: FILE, content: "plan\n" }),
      use("Edit", { file_path: FILE, old_string: "missing", new_string: "x" }),
      "not json at all tool_use",
    ].join("\n");
    expect(planFromTranscript(text)).toBe("plan\n");
  });

  it("is null when the conversation never wrote one", () => {
    expect(planFromTranscript(use("Bash", { command: "ls" }))).toBeNull();
    expect(planFromTranscript("")).toBeNull();
  });
});
