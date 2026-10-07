import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const calls: string[][] = [];
// The repository's PRs, as gh lists them.
let prs: Array<Record<string, unknown>> = [];
// Set to make gh fail with this stderr.
let failWith: string | null = null;
// Resolves gh's answers by hand, when a test holds them.
let hold: Promise<void> | null = null;
// Only `--head` lookups fail, when set.
let failHeadOnly = false;
// Whether gh's rate_limit shows GraphQL's bucket as spent.
let spent = true;

vi.mock("child_process", () => ({
  execFile: (
    _cmd: string,
    args: string[],
    _opts: unknown,
    cb: (err: Error | null, out?: { stdout: string }) => void
  ) => {
    calls.push(args);
    const answer = () => {
      if (args[0] === "api" && args[1] === "rate_limit")
        return cb(null, {
          stdout: JSON.stringify({
            graphql: { remaining: spent ? 0 : 4000, reset: RESET_S },
            core: { remaining: 4000, reset: RESET_S + 999 },
          }),
        });
      if (failWith && (!failHeadOnly || args.includes("--head")))
        return cb(
          Object.assign(new Error("Command failed"), { stderr: failWith })
        );
      const head = args[args.indexOf("--head") + 1];
      const open = args.includes("open");
      const out = prs.filter((p) =>
        open ? p.state === "OPEN" : p.headRefName === head
      );
      cb(null, { stdout: JSON.stringify(out) });
    };
    if (hold) void hold.then(answer);
    else answer();
  },
}));

const RESET_S = Math.floor(Date.now() / 1000) + 1800;

const pr = (number: number, branch: string, state = "OPEN", extra = {}) => ({
  number,
  url: `https://github.com/o/r/pull/${number}`,
  state,
  headRefName: branch,
  headRefOid: "abc1234",
  statusCheckRollup: [],
  isCrossRepository: false,
  createdAt: "2026-10-07T10:00:00Z",
  ...extra,
});

type Poll = typeof import("./pr-poll");
type Limit = typeof import("./gh-limit");
let poll: Poll;
let limit: Limit;

const lists = () =>
  calls.filter((a) => a[0] === "pr" && a.includes("open")).length;
const heads = () =>
  calls.filter((a) => a[0] === "pr" && a.includes("--head")).map((a) => a[3]);

beforeEach(async () => {
  calls.length = 0;
  prs = [];
  failWith = null;
  hold = null;
  spent = true;
  failHeadOnly = false;
  vi.resetModules();
  poll = await import("./pr-poll");
  limit = await import("./gh-limit");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("lookupPR", () => {
  it("finds every branch's open PR with one list of the repository", async () => {
    prs = [pr(1, "a"), pr(2, "b"), pr(3, "c")];
    const found = await Promise.all(
      ["a", "b", "c"].map((b) => poll.lookupPR("/repo", b))
    );
    expect(found.map((p) => p?.number)).toEqual([1, 2, 3]);
    expect(lists()).toBe(1);
    expect(heads()).toEqual([]);
    // Within a minute the list is reused.
    await poll.lookupPR("/repo", "a");
    expect(lists()).toBe(1);
  });

  it("shares one request between callers at the same time", async () => {
    prs = [pr(1, "a")];
    let release!: () => void;
    hold = new Promise((r) => (release = r));
    const pending = [
      poll.lookupPR("/repo", "a"),
      poll.lookupPR("/repo", "a"),
      poll.lookupPR("/repo", "b"),
    ];
    release();
    await Promise.all(pending);
    expect(lists()).toBe(1);
  });

  it("doesn't match a fork's PR, or one older than `since`, from the list", async () => {
    prs = [
      pr(1, "a", "OPEN", { isCrossRepository: true }),
      pr(2, "b", "OPEN", { createdAt: "2020-01-01T00:00:00Z" }),
      pr(3, "c"),
    ];
    await poll.lookupPR("/repo", "a");
    await poll.lookupPR("/repo", "b", { since: "2026-01-01T00:00:00Z" });
    await poll.lookupPR("/repo", "c", { since: "2026-01-01T00:00:00Z" });
    // Neither matched, so each was asked about on its own.
    expect(heads()).toEqual(["a", "b"]);
  });

  it("asks about a branch with no open PR on its own, at most every 5 minutes", async () => {
    vi.useFakeTimers({ now: Date.parse("2026-10-07T12:00:00Z") });
    prs = [pr(4, "done", "MERGED")];
    expect((await poll.lookupPR("/repo", "done"))?.state).toBe("MERGED");
    expect(heads()).toEqual(["done"]);
    vi.advanceTimersByTime(2 * 60_000);
    await poll.lookupPR("/repo", "done");
    expect(heads()).toEqual(["done"]);
    expect(lists()).toBe(2);
    vi.advanceTimersByTime(poll.BRANCH_TTL_MS);
    await poll.lookupPR("/repo", "done");
    expect(heads()).toEqual(["done", "done"]);
  });

  it("finds a PR opened after the list was read within a minute", async () => {
    vi.useFakeTimers({ now: Date.parse("2026-10-07T12:00:00Z") });
    expect(await poll.lookupPR("/repo", "new")).toBeNull();
    prs = [pr(5, "new")];
    // The miss is kept, but the next list has it.
    vi.advanceTimersByTime(poll.OPEN_TTL_MS + 1);
    expect((await poll.lookupPR("/repo", "new"))?.number).toBe(5);
  });

  it("fresh goes straight to gh, every time", async () => {
    prs = [pr(1, "a")];
    await poll.lookupPR("/repo", "a");
    await poll.lookupPR("/repo", "a", { fresh: true });
    await poll.lookupPR("/repo", "a", { fresh: true });
    expect(heads()).toEqual(["a", "a"]);
  });

  it("reads a gh failure as no PR, or throws it when strict", async () => {
    failWith = "HTTP 502";
    expect(await poll.lookupPR("/repo", "a")).toBeNull();
    await expect(
      poll.lookupPR("/repo", "b", { strict: true })
    ).rejects.toMatchObject({ stderr: "HTTP 502" });
  });

  it("keeps no failure: the next poll asks again", async () => {
    failWith = "HTTP 502";
    failHeadOnly = true;
    expect(await poll.lookupPR("/repo", "gone")).toBeNull();
    failWith = null;
    prs = [pr(6, "gone", "MERGED")];
    // Inside the 5 minutes a found answer would be kept for.
    expect((await poll.lookupPR("/repo", "gone"))?.state).toBe("MERGED");
    expect(heads()).toEqual(["gone", "gone"]);
    expect(lists()).toBe(1);
  });
});

describe("gh's rate limit", () => {
  it("backs every gh call off until the reset, and logs it", async () => {
    failWith = "GraphQL: API rate limit exceeded for user ID 1.";
    expect(await poll.lookupPR("/repo", "a")).toBeNull();
    expect(limit.ghBackedOffUntil()).toBe(RESET_S * 1000);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("rate limit exceeded")
    );
    failWith = null;
    prs = [pr(1, "a")];
    calls.length = 0;
    expect(await poll.lookupPR("/repo", "a")).toBeNull();
    await expect(
      poll.lookupPR("/repo", "a", { fresh: true, strict: true })
    ).rejects.toThrow(limit.GhBackoffError);
    expect(calls).toEqual([]);
  });

  it("lets gh run again once the limit resets", async () => {
    vi.useFakeTimers({ now: Date.now() });
    failWith = "API rate limit exceeded";
    await poll.lookupPR("/repo", "a");
    failWith = null;
    prs = [pr(1, "a")];
    vi.setSystemTime(RESET_S * 1000 + 1);
    expect(limit.ghBackedOffUntil()).toBeNull();
    expect((await poll.lookupPR("/repo", "a"))?.number).toBe(1);
  });

  it("backs off a minute, doubling, when no bucket reads as spent", async () => {
    vi.useFakeTimers({ now: Date.parse("2026-10-07T12:00:00Z") });
    spent = false;
    failWith = "You have exceeded a secondary rate limit";
    const t0 = Date.now();
    await poll.lookupPR("/repo", "a", { fresh: true });
    expect(limit.ghBackedOffUntil()).toBe(t0 + limit.DEFAULT_BACKOFF_MS);
    vi.setSystemTime(t0 + limit.DEFAULT_BACKOFF_MS);
    await poll.lookupPR("/repo", "a", { fresh: true });
    expect(limit.ghBackedOffUntil()).toBe(
      Date.now() + 2 * limit.DEFAULT_BACKOFF_MS
    );
    // A call that gets through starts the count again.
    vi.setSystemTime(Date.now() + 2 * limit.DEFAULT_BACKOFF_MS);
    failWith = null;
    await poll.lookupPR("/repo", "a", { fresh: true });
    failWith = "You have exceeded a secondary rate limit";
    await poll.lookupPR("/repo", "a", { fresh: true });
    expect(limit.ghBackedOffUntil()).toBe(
      Date.now() + limit.DEFAULT_BACKOFF_MS
    );
  });

  it("logs a kind of failure at most once a minute, and never the command line", async () => {
    failWith = "HTTP 502: Bad Gateway";
    await poll.lookupPR("/repo", "a", { fresh: true });
    await poll.lookupPR("/repo", "b", { fresh: true });
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      "[gh] pr list failed: HTTP 502: Bad Gateway"
    );
    expect(limit.ghBackedOffUntil()).toBeNull();
  });

  it("recognises a secondary rate limit, and nothing else", async () => {
    expect(
      limit.isRateLimit(new Error("You have exceeded a secondary rate limit"))
    ).toBe(true);
    expect(limit.isRateLimit(new Error("HTTP 404"))).toBe(false);
  });
});
