import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  ROLE_DECISIONS,
  STANDING_ROLES,
  isChiefRole,
  isLeadRole,
  isPeerStanding,
  isStandingRole,
  isTechRole,
  sqlChief,
  sqlLead,
  sqlNoRole,
  sqlStanding,
  sqlTech,
} from "./roles";

// Every place that reads `sessions.role` decides what a lead and the chief do
// there: act like the orchestrator (standing), like the Tech lead only
// (tech), or like an ordinary session (worker). The decision is the helper it
// calls, and this file lists how many of each every file makes. A new check
// fails here until it goes through a helper and is counted below.

const ROOT = path.resolve(__dirname, "../..");
const DIRS = [
  "app",
  "lib",
  "components",
  "hooks",
  "data",
  "stores",
  "contexts",
];
const SKIP = [
  /\.test\.tsx?$/,
  /^lib\/db\/migrations\//,
  /^lib\/db\/migrations\.generated\.ts$/,
  /__fixtures__\//,
  /^lib\/leads\/roles\.ts$/,
];

function sources(): string[] {
  const out: string[] = ["server.ts"];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), {
      withFileTypes: true,
    })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name !== "node_modules") walk(rel);
      } else if (/\.tsx?$/.test(e.name) && !SKIP.some((r) => r.test(rel)))
        out.push(rel);
    }
  };
  for (const d of DIRS) if (fs.existsSync(path.join(ROOT, d))) walk(d);
  return out;
}

// A check of a role that skips the helpers.
const RAW = [
  // s.role === "orchestrator", role !== "lead"
  /\brole\s*[!=]==?\s*["'`](orchestrator|lead|chief)["'`]/,
  // !s.role, !!s.role
  /!\s*[\w$]+(\?)?\.role\b(?!\s*[(=])/,
  // s.role ? .. : .., s.role && .., s.role || ..
  /[\w$]\??\.role\s*(\?(?![.?])|&&|\|\|)/,
  // if (s.role)
  /(?<![\w$])\(\s*[\w$]+\??\.role\s*\)/,
  // SQL
  /\brole\s+IS\s+(NOT\s+)?NULL\b/i,
  /\brole\s*(=|!=|<>)\s*'(orchestrator|lead|chief)'/,
  /\brole\s+(NOT\s+)?IN\s*\(/i,
];

// Lines the patterns catch that aren't a session's role: a model route's, a
// chat message's, a usage row's. Each must still match, so a stale one fails.
const NOT_SESSION_ROLE: { file: string; text: string; why: string }[] = [
  {
    file: "lib/chat/refresh.ts",
    text: `if (role === "orchestrator") return 0;`,
    why: "model role",
  },
  {
    file: "lib/chat/refresh.ts",
    text: `return role === "orchestrator"`,
    why: "refresh kind",
  },
  {
    file: "lib/usage/span.ts",
    text: `if (g.role === "orchestrator")`,
    why: "model role",
  },
  {
    file: "lib/orchestrator/claude-cli.ts",
    text: "run.role && !run.model",
    why: "model role",
  },
];

const HELPERS = {
  isStandingRole: "standing",
  sqlStanding: "standing",
  standingAskCount: "standing",
  isTechRole: "tech",
  sqlTech: "tech",
  isLeadRole: "lead",
  sqlLead: "lead",
  isChiefRole: "chief",
  sqlChief: "chief",
  sqlNoRole: "worker",
  isPeerStanding: "peer",
} as const;
type Decision = (typeof HELPERS)[keyof typeof HELPERS];

// Each file's decisions, by count. `!isStandingRole(...)` (an ordinary
// session only) counts as standing; the PR that added a site says why.
const SITES: Record<string, Partial<Record<Decision, number>>> = {
  "app/api/sessions/[id]/fresh/route.ts": { standing: 1 },
  "app/api/sessions/[id]/route.ts": { standing: 1 },
  "app/api/tmux/kill-all/route.ts": { standing: 1 },
  "components/Analyst/pair.ts": { standing: 1 },
  "components/Pane/index.tsx": { standing: 4, tech: 1 },
  "components/Schedules/ScheduleForm.tsx": { tech: 1 },
  "components/SessionList/RowSubtitle.tsx": { tech: 1 },
  "components/SessionList/SessionRow.tsx": { tech: 1 },
  "components/SessionList/useSidebarData.ts": { standing: 1, tech: 2 },
  "hooks/useNeedsYou.ts": { standing: 1 },
  "hooks/useOrchestratorHeader.ts": { standing: 1 },
  "lib/analyst/createLink.ts": { standing: 1 },
  "lib/away/report.ts": { worker: 1 },
  "lib/bus/index.ts": { tech: 2 },
  "lib/bus/read-scope.ts": { standing: 2 },
  "lib/bus/role-alias.ts": { tech: 1 },
  "lib/bus/targets.ts": { tech: 4 },
  "lib/bus/waits/tick.ts": { standing: 1 },
  "lib/chat/compact-context.ts": { standing: 1 },
  "lib/chat/mention-roots.ts": { standing: 1 },
  "lib/chat/runner.ts": { standing: 2 },
  "lib/chat/settings.ts": { standing: 2 },
  "lib/chat/worker/extras.ts": { standing: 1 },
  "lib/chat/worker/host.ts": { standing: 5 },
  "lib/done/archive.ts": { standing: 1 },
  "lib/done/auto-archive.ts": { worker: 1 },
  "lib/done/bulk.ts": { standing: 1, worker: 1 },
  "lib/done/index.ts": { standing: 1 },
  "lib/done/plan.ts": { standing: 1 },
  "lib/fork/extras.ts": { standing: 1 },
  "lib/fork/start.ts": { standing: 1 },
  "lib/hosts/peer-actions.ts": { peer: 1 },
  "lib/hosts/peer-sessions.ts": { peer: 1 },
  "lib/leads/adopt.ts": { worker: 1 },
  "lib/leads/adoptable.ts": { standing: 1 },
  "lib/leads/chief.ts": { chief: 2 },
  "lib/leads/company.ts": { worker: 1 },
  "lib/leads/home.ts": { chief: 1, lead: 2, standing: 1 },
  "lib/leads/profiles.ts": { chief: 1, lead: 1, tech: 1 },
  "lib/leads/setup.ts": { worker: 1 },
  "lib/leads/sweep.ts": { chief: 1 },
  "lib/leads/usage.ts": { standing: 1 },
  "lib/learning-cards/input.ts": { standing: 1 },
  "lib/live/drive.ts": { standing: 1 },
  "lib/models/launch.ts": { standing: 1 },
  "lib/models/session-role.ts": { standing: 1 },
  "lib/needs-you.ts": { standing: 4 },
  "lib/notify/index.ts": { standing: 1 },
  "lib/orchestrator/cross.ts": { chief: 1 },
  "lib/orchestrator/digest.ts": { worker: 1 },
  "lib/orchestrator/facts.ts": { worker: 1 },
  "lib/orchestrator/full-access.ts": { tech: 1 },
  "lib/orchestrator/home.ts": { standing: 1, tech: 3 },
  "lib/orchestrator/overview.ts": { worker: 1 },
  "lib/orchestrator/reminders.ts": { tech: 1 },
  "lib/projects.ts": { worker: 2 },
  "lib/resurrect/find.ts": { worker: 1 },
  "lib/resurrect/index.ts": { standing: 1 },
  "lib/schedules/index.ts": { tech: 2 },
  "lib/schedules/start.ts": { tech: 1 },
  "lib/schedules/store.ts": { tech: 2 },
  "lib/session-audit/sources.ts": { standing: 3 },
  "lib/session-groups/workspace.ts": { standing: 1 },
  "lib/sessions/launch.ts": { standing: 1 },
  "lib/sidebar/machines.ts": { standing: 1 },
  "lib/sidebar/row-actions.ts": { standing: 1 },
  "lib/sidebar/row-badge.ts": { standing: 1 },
  "lib/sidebar/row-menu.ts": { standing: 1, tech: 1 },
  "lib/sidebar/shelves.ts": { standing: 2 },
  "lib/status/collect.ts": { standing: 2 },
  "lib/tasks/held-replies.ts": { standing: 1 },
  "lib/tasks/move-targets.ts": { standing: 1 },
  "lib/tasks/pause.ts": { standing: 1 },
  "lib/tasks/starter.ts": { standing: 2 },
  "lib/workspaces.ts": { standing: 1, worker: 1 },
  "lib/worktree-sweep/findSettled.ts": { standing: 1 },
};

const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("role call sites", () => {
  const files = sources();

  it("check a session's role only through the helpers", () => {
    const raw: string[] = [];
    const allowedHits = new Set<number>();
    for (const rel of files) {
      read(rel)
        .split("\n")
        .forEach((line, i) => {
          if (!RAW.some((r) => r.test(line))) return;
          const ok = NOT_SESSION_ROLE.findIndex(
            (a) => a.file === rel && line.includes(a.text)
          );
          if (ok >= 0) allowedHits.add(ok);
          else raw.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(raw).toEqual([]);
    const stale = NOT_SESSION_ROLE.filter((_, i) => !allowedHits.has(i));
    expect(stale).toEqual([]);
  });

  it("list every file's decisions", () => {
    const found: Record<string, Partial<Record<Decision, number>>> = {};
    const call = new RegExp(`\\b(${Object.keys(HELPERS).join("|")})\\(`, "g");
    for (const rel of files) {
      const body = read(rel)
        .replace(/^import [\s\S]*?;$/gm, "")
        .replace(/function \w+\(/g, "");
      for (const m of body.matchAll(call)) {
        const d = HELPERS[m[1] as keyof typeof HELPERS];
        (found[rel] ??= {})[d] = (found[rel][d] ?? 0) + 1;
      }
    }
    expect(found).toEqual(SITES);
  });
});

describe("role decisions", () => {
  const ROLES = [null, ...STANDING_ROLES] as const;
  const table = (f: (r: string | null) => boolean) =>
    Object.fromEntries(ROLES.map((r) => [r ?? "none", f(r)]));

  it("decide every role", () => {
    expect(table(isStandingRole)).toEqual({
      none: false,
      orchestrator: true,
      lead: true,
      chief: true,
    });
    expect(table(isTechRole)).toEqual({
      none: false,
      orchestrator: true,
      lead: false,
      chief: false,
    });
    expect(table(isLeadRole)).toEqual({
      none: false,
      orchestrator: true,
      lead: true,
      chief: false,
    });
    expect(table(isChiefRole)).toEqual({
      none: false,
      orchestrator: false,
      lead: false,
      chief: true,
    });
    expect(Object.keys(ROLE_DECISIONS.standing).sort()).toEqual(
      ["none", ...STANDING_ROLES].sort()
    );
  });

  it("decide the same in SQL", () => {
    const db = new Database(":memory:");
    const sql = (expr: string, r: string | null) =>
      (
        db.prepare(`SELECT (${expr}) AS v FROM (SELECT ? AS r)`).get(r) as {
          v: number;
        }
      ).v === 1;
    for (const r of ROLES) {
      expect(sql(sqlStanding("r"), r)).toBe(isStandingRole(r));
      expect(sql(sqlNoRole("r"), r)).toBe(!isStandingRole(r));
      expect(sql(sqlTech("r"), r)).toBe(isTechRole(r));
      expect(sql(sqlLead("r"), r)).toBe(isLeadRole(r));
      expect(sql(sqlChief("r"), r)).toBe(isChiefRole(r));
    }
    db.close();
  });

  it("treat any role a newer peer reports as standing", () => {
    expect(isPeerStanding("orchestrator")).toBe(true);
    expect(isPeerStanding("something-newer")).toBe(true);
    expect(isPeerStanding(null)).toBe(false);
    expect(isPeerStanding(undefined)).toBe(false);
    expect(isPeerStanding("")).toBe(false);
  });
});
