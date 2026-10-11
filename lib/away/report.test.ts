import { describe, expect, it } from "vitest";
import { db } from "../db";
import { seedSession, seedWorkspace } from "../orchestrator/testing";
import { createWorkspace } from "../workspaces";
import {
  buildAwayReport,
  inFlightWhy,
  phoneSummary,
  reportMarkdown,
  type AwayReport,
} from "./report";
import { getAway, toSql } from "./state";

const HOUR = 60 * 60 * 1000;

function awayRow(startMs: number, endMs: number): number {
  return Number(
    db
      .prepare(
        `INSERT INTO away_periods (set_by, started_at, ended_at, ended_by) VALUES ('this machine', ?, ?, 'saad')`
      )
      .run(toSql(startMs), toSql(endMs)).lastInsertRowid
  );
}

function action(
  awayId: number,
  w: string,
  subject: string,
  kind: string,
  key: string,
  detail: string | null = null
) {
  db.prepare(
    `INSERT INTO away_actions (away_id, workspace_id, subject, kind, key, detail) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(awayId, w, subject, kind, key, detail);
}

const mine = (r: AwayReport, w: string) => r.workspaces.find((x) => x.id === w);

describe("the While you were away report", () => {
  it("lists merged with deploys and PR links, in flight with why, failures, and what waits on Saad", () => {
    const s = seedWorkspace();
    const w = s.workspace.id;
    const now = Date.now();
    const id = awayRow(now - HOUR, now + 60_000);

    // Merged while away (the trigger stamps merged_at), with its deploy.
    db.prepare(
      `UPDATE sessions SET pr_number = 42, pr_url = 'https://github.com/o/r/pull/42' WHERE id = ?`
    ).run(s.task);
    db.prepare(`UPDATE sessions SET task_status = 'merged' WHERE id = ?`).run(
      s.task
    );
    expect(
      (
        db
          .prepare(`SELECT merged_at FROM sessions WHERE id = ?`)
          .get(s.task) as {
          merged_at: string | null;
        }
      ).merged_at
    ).toBeTruthy();
    action(
      id,
      w,
      s.task,
      "deploy_ok",
      `deploy:${s.task}`,
      "aaaaaaa deployed, server healthy"
    );

    // Merged before Away: not in it.
    const before = seedSession({
      projectId: s.api.id,
      name: "old-fix",
      task: true,
    });
    db.prepare(
      `UPDATE sessions SET task_status = 'merged', merged_at = ? WHERE id = ?`
    ).run(toSql(now - 2 * HOUR), before);

    // In flight: a PR the review blocked, and one with no PR, nudged twice.
    const blocked = seedSession({
      projectId: s.api.id,
      name: "add-billing",
      task: true,
    });
    db.prepare(`UPDATE sessions SET pr_number = 43 WHERE id = ?`).run(blocked);
    db.prepare(
      `INSERT INTO orchestrator_checks (workspace_id, session_id, sha, kind, status) VALUES (?, ?, 'bbbbbbb222', 'review', 'block')`
    ).run(w, blocked);
    const stalled = seedSession({
      projectId: s.app.id,
      name: "docs-pass",
      task: true,
    });
    action(id, w, stalled, "nudge", `nudge:${stalled}:1`);
    action(id, w, stalled, "nudge", `nudge:${stalled}:2`);

    // Failed: a deploy, and an escalation in the window.
    action(
      id,
      w,
      blocked,
      "deploy_failed",
      `deploy:${blocked}`,
      "not deployed"
    );
    db.prepare(
      `INSERT INTO orchestrator_notes (workspace_id, kind, text) VALUES (?, 'escalation', 'task add-billing: review failed twice')`
    ).run(w);

    // Waiting: a hard line, with a link.
    db.prepare(
      `INSERT INTO orchestrator_asks (workspace_id, subject, kind, title, link, status) VALUES (?, 'title:domain', 'money', 'Buy the [domain](https://evil.test)', 'https://github.com/o/r/pull/9', 'open')`
    ).run(w);

    const empty = createWorkspace("quiet").id;
    const r = buildAwayReport(getAway(id)!, () => true);
    expect(mine(r, empty)).toBeUndefined();
    const ws = mine(r, w)!;
    expect(ws.merged).toEqual([
      {
        task: "add-auth",
        project: s.api.name,
        pr: 42,
        url: "https://github.com/o/r/pull/42",
        deploy: "deployed",
        deployDetail: "aaaaaaa deployed, server healthy",
      },
    ]);
    // Same-second seeds: the order between them is the id's.
    expect(ws.inFlight.map((t) => `${t.task}: ${t.why}`).sort()).toEqual([
      "add-billing: review found blocking issues at bbbbbbb",
      "docs-pass: no PR yet; nudged 2x while you were away",
    ]);
    expect(ws.failed.map((f) => f.what)).toEqual([
      "Deploy failed after add-billing (PR #43) merged: not deployed",
      "task add-billing: review failed twice",
    ]);
    expect(ws.waiting).toMatchObject([{ kind: "money", hardLine: true }]);
    expect(r.totals).toMatchObject({
      merged: 1,
      deployed: 1,
      waiting: 1,
      hardLines: 1,
    });

    const md = reportMarkdown(r);
    expect(md).toMatch(/^---\naudited: .+\n---\n# While you were away/);
    expect(md).toContain("[PR #42](https://github.com/o/r/pull/42)");
    // An ask title can't plant a link.
    expect(md).toContain("Buy the \\[domain\\](https://evil.test)");
    expect(phoneSummary(r)).toMatch(/1 merged \(1 deployed\)/);
    expect(phoneSummary(r)).toMatch(/waiting on you, 1 a hard line/);
  });

  it("says explicitly that nothing waits on Saad", () => {
    const s = seedWorkspace();
    const now = Date.now();
    const id = awayRow(now - HOUR, now);
    const r = buildAwayReport(getAway(id)!, () => false);
    const ws = mine(r, s.workspace.id)!;
    expect(ws.waiting).toEqual([]);
    expect(ws.inFlight[0].why).toBe("no PR yet");
    const md = reportMarkdown({ ...r, workspaces: [ws] });
    expect(md).toContain("## Waiting on you\n\n- None.");
    expect(
      phoneSummary({ ...r, totals: { ...r.totals, waiting: 0, hardLines: 0 } })
    ).toContain("Nothing waiting on you.");
  });
});

describe("why a task is still in flight", () => {
  const base = {
    prNumber: 5,
    armed: false,
    checks: [],
    failures: [],
    askKinds: [],
    nudges: 0,
  };
  const check = (kind: string, status: string) => ({
    session_id: "t",
    sha: "ccccccc333",
    kind,
    status,
  });

  it("puts Saad's part first, then what broke, then what it waits on", () => {
    expect(
      inFlightWhy({
        ...base,
        failures: [
          { session_id: "t", gate: "ci", count: 2, escalated_at: "x" },
        ],
        askKinds: ["decision"],
      })
    ).toBe("with you: the ci gate failed twice");
    expect(inFlightWhy({ ...base, askKinds: ["gate"] })).toBe(
      "waiting on your answer (gate)"
    );
    expect(inFlightWhy({ ...base, checks: [check("ci", "block")] })).toBe(
      "CI failing at ccccccc"
    );
    expect(inFlightWhy({ ...base, checks: [check("review", "running")] })).toBe(
      "review of ccccccc running"
    );
    expect(inFlightWhy(base)).toBe("PR open, waiting on its review");
    expect(
      inFlightWhy({ ...base, armed: true, checks: [check("review", "pass")] })
    ).toBe("armed to merge, waiting on its gates");
    expect(inFlightWhy({ ...base, checks: [check("review", "pass")] })).toBe(
      "PR open and reviewed, waiting on sign-off"
    );
  });
});
