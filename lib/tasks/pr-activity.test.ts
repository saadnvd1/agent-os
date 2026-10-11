import { beforeEach, describe, expect, it, vi } from "vitest";

// gh's answers, as JSON, for each call made.
const answers: unknown[] = [];
const calls: string[][] = [];
vi.mock("./gh", () => ({
  run: async (_cmd: string, args: string[]) => {
    calls.push(args);
    return JSON.stringify(answers.shift());
  },
}));

const { fingerprints, jobOf, prActivity, repoOfPR } =
  await import("./pr-activity");

const repo = { owner: "o", name: "r" };

beforeEach(() => {
  answers.length = 0;
  calls.length = 0;
});

describe("fingerprints", () => {
  it("asks for every PR in one query and reads each alias back", async () => {
    answers.push({
      data: {
        repository: {
          p7: {
            createdAt: "2026-10-10T00:00:00Z",
            reviews: { totalCount: 2, nodes: [{ id: "R2" }] },
            comments: { totalCount: 0, nodes: [] },
          },
          p9: null,
        },
      },
    });
    const prints = await fingerprints("/tmp", repo, [7, 9, -1]);
    expect(calls).toHaveLength(1);
    const query = calls[0].find((a) => a.startsWith("query="))!;
    expect(query).toContain("p7: pullRequest(number: 7)");
    expect(query).toContain("p9: pullRequest(number: 9)");
    expect(query).not.toContain("-1");
    expect(calls[0]).toEqual(expect.arrayContaining(["-f", "owner=o"]));
    expect([...prints]).toEqual([
      [7, { print: "2:R2/0:", createdAt: "2026-10-10T00:00:00Z" }],
    ]);
  });

  it("makes no call for no PRs", async () => {
    expect((await fingerprints("/tmp", repo, [])).size).toBe(0);
    expect(calls).toEqual([]);
  });
});

describe("prActivity", () => {
  it("maps reviews and comments, drops pending reviews, and sorts by time", async () => {
    answers.push({
      data: {
        viewer: { login: "me" },
        repository: {
          pullRequest: {
            reviews: {
              nodes: [
                {
                  id: "R1",
                  state: "CHANGES_REQUESTED",
                  body: "no",
                  submittedAt: "2026-10-10T00:02:00Z",
                  authorAssociation: "MEMBER",
                  author: null,
                  comments: {
                    nodes: [
                      { path: "a.ts", line: null, originalLine: 4, body: "x" },
                    ],
                  },
                },
                {
                  id: "R2",
                  state: "PENDING",
                  body: "draft",
                  submittedAt: null,
                  authorAssociation: "OWNER",
                  author: { login: "bob" },
                  comments: { nodes: [] },
                },
              ],
            },
            comments: {
              nodes: [
                {
                  id: "C1",
                  body: "hi",
                  createdAt: "2026-10-10T00:01:00Z",
                  authorAssociation: "NONE",
                  author: { login: "eve" },
                },
              ],
            },
          },
        },
      },
    });
    const a = await prActivity("/tmp", repo, 7);
    expect(calls[0]).toEqual(expect.arrayContaining(["-F", "number=7"]));
    expect(a).toEqual({
      viewer: "me",
      events: [
        {
          id: "C1",
          kind: "comment",
          state: null,
          author: "eve",
          association: "NONE",
          at: "2026-10-10T00:01:00Z",
          body: "hi",
          notes: [],
        },
        {
          id: "R1",
          kind: "review",
          state: "CHANGES_REQUESTED",
          author: "ghost",
          association: "MEMBER",
          at: "2026-10-10T00:02:00Z",
          body: "no",
          notes: [{ path: "a.ts", line: 4, body: "x" }],
        },
      ],
    });
  });

  it("throws when the PR isn't there", async () => {
    answers.push({ data: { viewer: { login: "me" }, repository: {} } });
    await expect(prActivity("/tmp", repo, 7)).rejects.toThrow("not found");
  });
});

describe("jobOf and repoOfPR", () => {
  it("reads an Actions job, and nothing from another CI's URL", () => {
    expect(
      jobOf("https://github.com/o/r/actions/runs/38105052671/job/114368676280")
    ).toBe("114368676280");
    expect(jobOf("https://ci.example.com/build/5")).toBeNull();
    expect(jobOf(null)).toBeNull();
  });

  it("reads the owner and name from a PR URL", () => {
    expect(repoOfPR("https://github.com/o/r/pull/7")).toEqual(repo);
    expect(repoOfPR("https://example.com/o/r/pull/7")).toBeNull();
  });
});
