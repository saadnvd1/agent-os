import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Two machines; each listing says which one was asked.
const asked = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/hosts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hosts")>()),
  listHosts: () => [{ id: "local" }, { id: "box" }],
  hostExecFile: async (host: string, _file: string, args: string[]) => {
    if (args[0] !== "list-sessions") return { stdout: "", stderr: "" };
    asked.push(host);
    return {
      stdout: `${host}-s\t1\t1\t/tmp\t0\t1\tzsh\t42\ttitle\n`,
      stderr: "",
    };
  },
}));

const { statusDetector } = await import("@/lib/status-detector");
const { setControlManager } = await import("@/lib/tmux/control");
const { resumeIdWait, RESUME_ID_FOUND_MS } = await import("./collect");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000_000);
  asked.length = 0;
});
afterEach(() => {
  setControlManager(undefined);
  vi.useRealTimers();
});

describe("session listing per machine", () => {
  it("lists this machine less often while control clients watch it, keeping every machine's sessions", async () => {
    setControlManager({ size: () => 1 } as never);
    statusDetector.invalidateLocal();
    await statusDetector.refreshCache();
    expect(asked.sort()).toEqual(["box", "local"]);
    expect(statusDetector.paneProcess("local-s")).toBe(42);

    asked.length = 0;
    vi.setSystemTime(10_003_000);
    await statusDetector.refreshCache();
    expect(asked).toEqual(["box"]);
    // This machine wasn't listed again, and its sessions are still there.
    expect(statusDetector.sessionExists("local-s")).toBe(true);
    expect(statusDetector.sessionExists("box-s")).toBe(true);

    asked.length = 0;
    vi.setSystemTime(10_011_000);
    await statusDetector.refreshCache();
    expect(asked.sort()).toEqual(["box", "local"]);
  });

  it("lists once for callers asking at the same moment", async () => {
    vi.setSystemTime(20_000_000);
    statusDetector.invalidateLocal();
    await Promise.all([
      statusDetector.refreshCache(),
      statusDetector.refreshCache(),
    ]);
    expect(asked.filter((h) => h === "local")).toHaveLength(1);
  });
});

describe("resumeIdWait", () => {
  it("backs off while there's no id, and holds a found one longer", () => {
    let prev: { id: string | null; wait: number } | undefined;
    const waits: number[] = [];
    for (const id of [null, null, null, null, null, "abc", null]) {
      const wait = resumeIdWait(prev, id);
      waits.push(wait);
      prev = { id, wait };
    }
    expect(waits).toEqual([
      60_000,
      120_000,
      240_000,
      480_000,
      600_000,
      RESUME_ID_FOUND_MS,
      60_000,
    ]);
  });
});

describe("what a gate reads", () => {
  it("is tmux's own capture over the control client, not the kept screen", async () => {
    const queries: string[] = [];
    setControlManager({
      size: () => 1,
      screen: () => "kept copy",
      query: async (_name: string, line: string) => {
        queries.push(line);
        return ["BLOCKED: need a decision"];
      },
    } as never);
    expect(await statusDetector.capturePane("local-s")).toBe(
      "BLOCKED: need a decision"
    );
    expect(queries).toEqual(["capture-pane -p -t =local-s:"]);
    // A fresh read of a reported question is tmux's too.
    expect(await statusDetector.captureScreen("local-s", true)).toBe(
      "BLOCKED: need a decision"
    );
    // Only an ordinary read takes the kept screen.
    expect(await statusDetector.captureScreen("local-s")).toBe("kept copy");
  });
});
