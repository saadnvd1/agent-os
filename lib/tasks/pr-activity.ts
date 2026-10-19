// Reviews and comments on task PRs, read in two steps: a fingerprint of
// every watched PR in a repository from one GraphQL query (counts and the
// latest ids), and one PR's reviews and comments only when its fingerprint
// moved. Plus the part of a failed Actions job's log around its error.

import { redact } from "../orchestrator/untrusted";
import { run } from "./gh";

export interface Repo {
  owner: string;
  name: string;
}

export const repoOfPR = (url: string): Repo | null => {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/\d+/.exec(url);
  return m ? { owner: m[1], name: m[2] } : null;
};

export interface Fingerprint {
  // Changes whenever a review or a conversation comment is added.
  print: string;
  createdAt: string;
}

const graphql = async (
  dir: string,
  query: string,
  vars: Record<string, string | number>
) => {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [k, v] of Object.entries(vars))
    args.push(typeof v === "number" ? "-F" : "-f", `${k}=${v}`);
  return JSON.parse(await run("gh", args, dir, 30000)) as {
    data?: { viewer?: { login: string }; repository?: Record<string, unknown> };
  };
};

type Last = { totalCount: number; nodes: { id: string }[] };

// One query for all the given PRs of a repository.
export async function fingerprints(
  dir: string,
  repo: Repo,
  numbers: number[]
): Promise<Map<number, Fingerprint>> {
  const prs = numbers.filter((n) => Number.isInteger(n) && n > 0);
  const out = new Map<number, Fingerprint>();
  if (!prs.length) return out;
  const fields = prs
    .map(
      (n) =>
        `p${n}: pullRequest(number: ${n}) { createdAt reviews(last: 1) { totalCount nodes { id } } comments(last: 1) { totalCount nodes { id } } }`
    )
    .join(" ");
  const res = await graphql(
    dir,
    `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`,
    { owner: repo.owner, name: repo.name }
  );
  for (const n of prs) {
    const pr = res.data?.repository?.[`p${n}`] as
      { createdAt: string; reviews: Last; comments: Last } | null | undefined;
    if (!pr) continue;
    const part = (l: Last) => `${l.totalCount}:${l.nodes[0]?.id ?? ""}`;
    out.set(n, {
      print: `${part(pr.reviews)}/${part(pr.comments)}`,
      createdAt: pr.createdAt,
    });
  }
  return out;
}

export interface PRNote {
  path: string;
  line: number | null;
  body: string;
}

export interface PREvent {
  id: string;
  kind: "review" | "comment";
  // A review's: APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED, PENDING.
  state: string | null;
  author: string;
  // GitHub's word on the author: OWNER, MEMBER, COLLABORATOR, NONE...
  association: string;
  at: string;
  body: string;
  // A review's inline comments.
  notes: PRNote[];
}

export interface PRActivity {
  // Who gh is signed in as: the task's own comments are posted as this.
  viewer: string;
  events: PREvent[];
}

type Author = { login: string } | null;

// The latest reviews and conversation comments on one PR.
export async function prActivity(
  dir: string,
  repo: Repo,
  number: number
): Promise<PRActivity> {
  const res = await graphql(
    dir,
    `
      query ($owner: String!, $name: String!, $number: Int!) {
        viewer {
          login
        }
        repository(owner: $owner, name: $name) {
          pullRequest(number: $number) {
            reviews(last: 30) {
              nodes {
                id
                state
                body
                submittedAt
                authorAssociation
                author {
                  login
                }
                comments(first: 20) {
                  nodes {
                    path
                    line
                    originalLine
                    body
                  }
                }
              }
            }
            comments(last: 30) {
              nodes {
                id
                body
                createdAt
                authorAssociation
                author {
                  login
                }
              }
            }
          }
        }
      }
    `,
    { owner: repo.owner, name: repo.name, number }
  );
  const pr = res.data?.repository?.pullRequest as
    | {
        reviews: {
          nodes: {
            id: string;
            state: string;
            body: string;
            submittedAt: string | null;
            authorAssociation: string;
            author: Author;
            comments: {
              nodes: {
                path: string;
                line: number | null;
                originalLine: number | null;
                body: string;
              }[];
            };
          }[];
        };
        comments: {
          nodes: {
            id: string;
            body: string;
            createdAt: string;
            authorAssociation: string;
            author: Author;
          }[];
        };
      }
    | null
    | undefined;
  if (!pr || !res.data?.viewer) throw new Error(`PR #${number} not found`);
  return {
    viewer: res.data.viewer.login,
    events: [
      ...pr.reviews.nodes
        .filter((r) => r.submittedAt)
        .map((r) => ({
          id: r.id,
          kind: "review" as const,
          state: r.state,
          author: r.author?.login ?? "ghost",
          association: r.authorAssociation,
          at: r.submittedAt!,
          body: r.body ?? "",
          notes: r.comments.nodes.map((c) => ({
            path: c.path,
            line: c.line ?? c.originalLine,
            body: c.body ?? "",
          })),
        })),
      ...pr.comments.nodes.map((c) => ({
        id: c.id,
        kind: "comment" as const,
        state: null,
        author: c.author?.login ?? "ghost",
        association: c.authorAssociation,
        at: c.createdAt,
        body: c.body ?? "",
        notes: [],
      })),
    ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)),
  };
}

export const LOG_LINES = 60;
const LINE_MAX = 240;
// The line a failure is reported on; the runner's own last line isn't it.
const ERROR =
  /##\[error\]|\berror\b|\bfail(ed|ure|s)?\b|\bFAIL\b|✗|×|AssertionError|panic:/i;
const RUNNER_EXIT = /Process completed with exit code/;

export interface FailedLog {
  step: string | null;
  tail: string;
}

// `gh run view --log-failed` lines are "job<TAB>step<TAB>time text". Keeps
// LOG_LINES lines from a little before the first error, without timestamps,
// colour codes or anything token-shaped.
export function trimLog(raw: string, max = LOG_LINES): FailedLog {
  const rows = raw
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      const parts = l.split("\t");
      const step = parts.length >= 3 ? parts[1] : null;
      const text = (parts.length >= 3 ? parts.slice(2).join("\t") : l)
        .replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
        .replace(/^﻿?\d{4}-\d\d-\d\dT[\d:.]+Z ?/, "");
      return {
        step,
        text: text.length > LINE_MAX ? `${text.slice(0, LINE_MAX)}…` : text,
      };
    });
  if (!rows.length) return { step: null, tail: "" };
  const hit = rows.findIndex(
    (r) => ERROR.test(r.text) && !RUNNER_EXIT.test(r.text)
  );
  const anchor = hit >= 0 ? hit : rows.length - 1;
  const start =
    hit >= 0
      ? Math.max(0, Math.min(hit - Math.floor(max / 3), rows.length - max))
      : Math.max(0, rows.length - max);
  const kept = rows.slice(start, start + max);
  return {
    step: rows[anchor].step,
    tail: redact(kept.map((r) => r.text).join("\n")),
  };
}

// The Actions job a check's details URL points at.
export const jobOf = (url: string | null | undefined) =>
  url ? (/\/actions\/runs\/\d+\/job\/(\d+)/.exec(url)?.[1] ?? null) : null;

// The failed steps' log of an Actions job, trimmed; null for a check that
// isn't an Actions job.
export async function failedLog(
  dir: string,
  repo: Repo,
  url: string | null | undefined
): Promise<FailedLog | null> {
  const raw = await failedJobLog(dir, repo, url);
  return raw === null ? null : trimLog(raw);
}

// The same log whole, as gh prints it.
export async function failedJobLog(
  dir: string,
  repo: Repo,
  url: string | null | undefined
): Promise<string | null> {
  const job = jobOf(url);
  if (!job) return null;
  return run(
    "gh",
    [
      "run",
      "view",
      "--repo",
      `${repo.owner}/${repo.name}`,
      "--job",
      job,
      "--log-failed",
    ],
    dir,
    60000
  );
}
