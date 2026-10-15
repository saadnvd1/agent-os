import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";

// Where "@" is answered from: an orchestrator's from its HQ and projects, any
// other session's from its own folder, as ever.
const files = vi.hoisted(() => ({
  multi: vi.fn(async () => [{ path: "/multi", dir: false }]),
  single: vi.fn(async () => [{ path: "single", dir: false }]),
  warm: vi.fn(),
}));
vi.mock("./files", async (original) => ({
  ...(await original<typeof import("./files")>()),
  multiRootFileSuggestions: files.multi,
  fallbackFileSuggestions: files.single,
  warmFileIndexes: files.warm,
}));

const { chatFileSuggestions, warmChatFileIndexes } = await import("./runner");

function session(role: string | null) {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO sessions (id, name, tmux_name, working_directory, role)
     VALUES (?, 's', ?, '/tmp', ?)`
  ).run(id, `claude-${id}`, role);
  return id;
}

beforeEach(() => vi.clearAllMocks());

describe("chatFileSuggestions", () => {
  it("answers an orchestrator from its roots, keyed by the session", async () => {
    const id = session("orchestrator");
    expect(await chatFileSuggestions(id, "mis")).toEqual([
      { path: "/multi", dir: false },
    ]);
    expect(files.multi).toHaveBeenCalledWith(expect.any(Array), "mis", id);
    expect(files.single).not.toHaveBeenCalled();
  });

  it("keeps any other session on its own folder", async () => {
    const id = session(null);
    expect(await chatFileSuggestions(id, "mis")).toEqual([
      { path: "single", dir: false },
    ]);
    expect(files.single).toHaveBeenCalledWith("/tmp", "mis");
    expect(files.multi).not.toHaveBeenCalled();
  });
});

describe("warmChatFileIndexes", () => {
  it("starts an orchestrator's indexes and no one else's", () => {
    warmChatFileIndexes(session(null));
    expect(files.warm).not.toHaveBeenCalled();
    warmChatFileIndexes(session("orchestrator"));
    expect(files.warm).toHaveBeenCalledTimes(1);
  });
});
