import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// One local tmux session whose output time the test moves; each capture
// returns a new screen so a cached one is told apart.
const tmux = vi.hoisted(() => ({ output: 0, captures: 0 }));
vi.mock("@/lib/hosts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hosts")>()),
  listHosts: () => [{ id: "local" }],
  hostExecFile: async (_host: string, _file: string, args: string[]) => {
    if (args[0] === "list-sessions")
      return {
        stdout: `s1\t1\t${tmux.output}\t/tmp\t0\t1\tclaude\ttitle\n`,
        stderr: "",
      };
    return { stdout: `screen ${++tmux.captures}\n`, stderr: "" };
  },
}));

const { statusDetector, listingFailure, screenStillFresh } =
  await import("@/lib/status-detector");

const T0 = 1_000_000_500; // ms, half a second into second 1_000_000
const at = async (ms: number) => {
  vi.setSystemTime(ms);
  await statusDetector.refreshCache();
  return statusDetector.captureScreen("s1");
};

beforeEach(() => {
  vi.useFakeTimers();
  tmux.captures = 0;
});
afterEach(() => vi.useRealTimers());

describe("reading a pane's screen", () => {
  it("reads it again only once the pane has printed", async () => {
    tmux.output = 999_990;
    expect(await at(T0 + 10_000)).toBe("screen 1");
    expect(await at(T0 + 13_000)).toBe("screen 1");
    tmux.output = 1_000_014;
    expect(await at(T0 + 16_000)).toBe("screen 2");
    expect(await at(T0 + 19_000)).toBe("screen 2");
  });

  it("doesn't trust a read from the same second as the last output", async () => {
    tmux.output = Math.floor((T0 + 40_000) / 1000);
    expect(await at(T0 + 40_000)).toBe("screen 1");
    // Output later in that second wouldn't move the time: read again.
    expect(await at(T0 + 43_000)).toBe("screen 2");
    expect(await at(T0 + 46_000)).toBe("screen 2");
  });

  it("reads it again after 30s regardless, or whenever asked fresh", async () => {
    tmux.output = 999_990;
    expect(await at(T0 + 60_000)).toBe("screen 1");
    expect(await at(T0 + 91_000)).toBe("screen 2");
    expect(await statusDetector.captureScreen("s1", true)).toBe("screen 3");
  });
});

describe("screenStillFresh", () => {
  const read = { output: 10, at: 11_200 };
  it("needs a listing taken after the read", () => {
    expect(screenStillFresh(read, 10, 12_000, 12_000)).toBe(true);
    expect(screenStillFresh(read, 10, 11_000, 12_000)).toBe(false);
    expect(screenStillFresh(read, 0, 12_000, 12_000)).toBe(false);
  });
});

describe("a tmux listing that fails", () => {
  it("is an empty list only when no server is running", () => {
    expect(
      listingFailure({ code: 1, stderr: "no server running on /tmp/x" })
    ).toEqual({ stdout: "" });
    expect(
      listingFailure({
        code: 1,
        stderr: "error connecting to /tmp/x (No such file or directory)",
      })
    ).toEqual({ stdout: "" });
  });

  it("is the host's error otherwise, so the last listing stands", () => {
    for (const err of [
      { killed: true, code: null },
      { code: 255, stderr: "ssh: connect to host devbox port 22" },
      { code: "EAGAIN" },
      { code: "ENOENT" },
      { code: 1, stderr: "lost server" },
    ])
      expect(() => listingFailure(err)).toThrow();
  });
});
