/**
 * Builds the demo world from nothing: a fake home with git repos, an AgentOS
 * database made by the app's own schema and migrations, and an isolated tmux
 * server whose panes look like agents at work.
 *
 *     npx tsx scripts/screenshots/seed.ts
 */
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { execFileSync } from "child_process";
import {
  BIN,
  CODE,
  DB_PATH,
  HOME,
  PEER_PORT,
  ROOT,
  SCREENS,
  TMUX_TMPDIR,
  TMUX_SOCKET,
  demoTmuxArgs,
  demoEnv,
} from "./config";
import { createRepos } from "./repos";
import { PANES } from "./panes";
import {
  checkoutConversation,
  docsConversation,
  exportTaskConversation,
} from "./chat";
import { orchestratorAsks, orchestratorConversation } from "./orchestrator";
import { PEER_HOST } from "./peer";
import { GH_SHIM, PRS } from "./gh";
import type { ChatItem } from "../../lib/chat/events";

interface SessionSeed {
  key: string;
  name: string;
  project: string;
  view?: "chat" | "terminal";
  pane?: keyof typeof PANES;
  minutesAgo: number;
  task?: { prompt: string; status: "running" | "merged"; branch: string };
  chat?: (start: number) => ChatItem[];
}

const WORKSPACES = [
  {
    name: "Work",
    projects: ["storefront", "payments-api", "mobile-app", "infra"],
  },
  { name: "Side projects", projects: ["docs-site", "ml-pipeline"] },
];

const SESSIONS: SessionSeed[] = [
  {
    key: "checkout",
    name: "checkout-totals",
    project: "storefront",
    view: "chat",
    minutesAgo: 6,
    chat: checkoutConversation,
  },
  {
    key: "flaky",
    name: "flaky-cart-test",
    project: "storefront",
    pane: "flakyCart",
    minutesAgo: 14,
    task: {
      prompt:
        "The cart quantity test fails about one run in ten. Find the race and fix it.",
      status: "running",
      branch: "fix/flaky-cart-test",
    },
  },
  {
    key: "export",
    name: "order-export",
    project: "storefront",
    view: "chat",
    minutesAgo: 2,
    chat: exportTaskConversation,
    task: {
      prompt:
        "Let admins export the orders table as CSV, with the current filters applied.",
      status: "running",
      branch: "feat/order-export-csv",
    },
  },
  {
    key: "webhooks",
    name: "webhook-retries",
    project: "payments-api",
    pane: "webhooks",
    minutesAgo: 3,
  },
  {
    key: "idem",
    name: "idempotency-keys",
    project: "payments-api",
    pane: "idempotency",
    minutesAgo: 52,
    task: {
      prompt:
        "Add idempotency keys to POST /charges so retried requests never double-charge.",
      status: "running",
      branch: "feat/idempotency-keys",
    },
  },
  {
    key: "offline",
    name: "offline-sync",
    project: "mobile-app",
    pane: "offlineSync",
    minutesAgo: 9,
  },
  {
    key: "push",
    name: "push-notifications",
    project: "mobile-app",
    pane: "idempotency",
    minutesAgo: 60 * 26,
    task: {
      prompt: "Send a push notification when an order ships.",
      status: "merged",
      branch: "feat/order-shipped-push",
    },
  },
  {
    key: "creds",
    name: "rotate-db-creds",
    project: "infra",
    pane: "dbCreds",
    minutesAgo: 21,
    task: {
      prompt: "Rotate the staging database credentials and update the secret.",
      status: "running",
      branch: "chore/rotate-staging-db",
    },
  },
  {
    key: "search",
    name: "sidebar-search",
    project: "docs-site",
    view: "chat",
    minutesAgo: 60 * 5,
    chat: docsConversation,
  },
  {
    key: "backfill",
    name: "feature-backfill",
    project: "ml-pipeline",
    pane: "backfill",
    minutesAgo: 33,
  },
];

const BUS: {
  from: string | null;
  to: string;
  body: string;
  minutesAgo: number;
}[] = [
  {
    from: "idem",
    to: "checkout",
    minutesAgo: 41,
    body: "Heads up: POST /charges now takes an Idempotency-Key header. Checkout should send one per payment attempt.",
  },
  {
    from: "checkout",
    to: "idem",
    minutesAgo: 38,
    body: "Will do. I'll derive it from the cart id and the attempt number. Any length limit?",
  },
  {
    from: "idem",
    to: "checkout",
    minutesAgo: 37,
    body: "Up to 255 characters. Keys expire after 24 hours.",
  },
  {
    from: null,
    to: "flaky",
    minutesAgo: 16,
    body: "Run the cart suite 20 times before calling it fixed.",
  },
  {
    from: "offline",
    to: "idem",
    minutesAgo: 8,
    body: "Replayed writes from the outbox will reuse their original key, so retries stay safe.",
  },
];

function writeHome(): void {
  fs.mkdirSync(path.join(HOME, ".claude"), { recursive: true });
  fs.writeFileSync(
    path.join(HOME, ".gitconfig"),
    "[user]\n\tname = Alex Rivera\n\temail = alex@example.com\n[init]\n\tdefaultBranch = main\n"
  );
  // Every shell the app opens (terminal tabs, tmux attach) must find the
  // demo's own tmux server, never the machine's, whichever shell it is.
  const env = `export TMUX_TMPDIR=${TMUX_TMPDIR}\nexport PATH=${BIN}:$PATH\nunset TMUX TMUX_PANE\n`;
  fs.writeFileSync(path.join(HOME, ".zshenv"), env);
  fs.writeFileSync(
    path.join(HOME, ".zshrc"),
    "PROMPT='%F{245}%~%f %F{141}❯%f '\n"
  );
  fs.writeFileSync(path.join(HOME, ".profile"), env);
  fs.writeFileSync(
    path.join(HOME, ".bashrc"),
    `${env}PS1='\\[\\e[38;5;245m\\]\\w\\[\\e[0m\\] \\[\\e[38;5;141m\\]❯\\[\\e[0m\\] '\n`
  );
  fs.writeFileSync(path.join(HOME, ".tmux.conf"), "set -g status off\n");
  fs.mkdirSync(BIN, { recursive: true });
  fs.writeFileSync(path.join(BIN, "gh"), GH_SHIM, { mode: 0o755 });
  // So the new-session picker counts Claude Code as installed. It only
  // answers --version: nothing in the demo can start a real agent.
  fs.writeFileSync(
    path.join(BIN, "claude"),
    '#!/bin/sh\n[ "$1" = "--version" ] && echo "2.1.0 (Claude Code)" && exit 0\nexit 1\n',
    { mode: 0o755 }
  );
  fs.writeFileSync(path.join(ROOT, "prs.json"), JSON.stringify(PRS));
}

function tmux(args: string[]): void {
  fs.mkdirSync(path.dirname(TMUX_SOCKET), { recursive: true, mode: 0o700 });
  execFileSync("tmux", demoTmuxArgs(args), { env: demoEnv(), stdio: "pipe" });
}

async function seedDb(): Promise<void> {
  process.env.DB_PATH = DB_PATH;
  const { getDb } = await import("../../lib/db");
  const db = getDb();
  const projectIds = new Map<string, string>();
  const workspaceIds = new Map<string, string>();

  WORKSPACES.forEach((ws, wi) => {
    const wsId = randomUUID();
    workspaceIds.set(ws.name, wsId);
    db.prepare(
      `INSERT INTO workspaces (id, name, sort_order) VALUES (?, ?, ?)`
    ).run(wsId, ws.name, wi);
    ws.projects.forEach((name, pi) => {
      const id = randomUUID();
      projectIds.set(name, id);
      db.prepare(
        `INSERT INTO projects (id, name, working_directory, sort_order, workspace_id) VALUES (?, ?, ?, ?, ?)`
      ).run(id, name, `~/code/${name}`, wi * 10 + pi, wsId);
    });
  });

  const sessionIds = new Map<string, string>();
  const now = Date.now();
  for (const s of SESSIONS) {
    const id = randomUUID();
    sessionIds.set(s.key, id);
    const tmuxName = `claude-${id}`;
    const when = `-${s.minutesAgo} minutes`;
    db.prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory, project_id, agent_type, model, view,
         task_prompt, task_status, branch_name, base_branch, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'claude', 'opus', ?, ?, ?, ?, ?, datetime('now', ?), datetime('now', ?))`
    ).run(
      id,
      s.name,
      tmuxName,
      `~/code/${s.project}`,
      projectIds.get(s.project),
      s.view ?? "terminal",
      s.task?.prompt ?? null,
      s.task?.status ?? null,
      s.task?.branch ?? null,
      s.task ? "main" : null,
      when,
      when
    );
    if (s.chat) {
      const insert = db.prepare(
        `INSERT INTO chat_items (session_id, item_id, seq, data) VALUES (?, ?, ?, ?)`
      );
      s.chat(now - s.minutesAgo * 60000).forEach((item, i) =>
        insert.run(id, item.id, i + 1, JSON.stringify(item))
      );
    }
    if (s.pane && s.task?.status !== "merged") {
      const pane = PANES[s.pane];
      const file = path.join(SCREENS, `${s.key}.txt`);
      fs.writeFileSync(file, pane.screen);
      const script = path.join(__dirname, "pane.mjs");
      tmux([
        "new-session",
        "-d",
        "-s",
        tmuxName,
        "-x",
        "120",
        "-y",
        "40",
        "-c",
        path.join(CODE, s.project),
        `'${process.execPath}' '${script}' '${file}' '${pane.title}'`,
      ]);
    }
  }

  seedOrchestrator(db, workspaceIds.get("Work")!, sessionIds, now);
  seedLinkedMachine(db);

  for (const m of BUS) {
    const name = (key: string | null) =>
      key ? SESSIONS.find((s) => s.key === key)!.name : "you";
    const when = `-${m.minutesAgo} minutes`;
    db.prepare(
      `INSERT INTO bus_messages (from_id, from_name, to_id, to_name, body, created_at, delivered_at, read_at)
       VALUES (?, ?, ?, ?, ?, datetime('now', ?), datetime('now', ?), datetime('now', ?))`
    ).run(
      m.from ? sessionIds.get(m.from) : null,
      name(m.from),
      sessionIds.get(m.to),
      name(m.to),
      m.body,
      when,
      when,
      when
    );
  }
  db.close();
}

type Db = ReturnType<typeof import("../../lib/db").getDb>;

// The Work workspace's orchestrator, pinned, with its chat and two asks.
function seedOrchestrator(
  db: Db,
  workspaceId: string,
  sessionIds: Map<string, string>,
  now: number
): void {
  const id = randomUUID();
  const start = now - 40 * 60000;
  const dir = path.join(HOME, ".agent-os", "orchestrators", workspaceId);
  fs.mkdirSync(dir, { recursive: true });
  db.prepare(
    `INSERT INTO sessions (id, name, tmux_name, working_directory, model, group_path,
       agent_type, project_id, host_id, view, chat_access, role, workspace_id, pinned,
       name_source, created_at, updated_at)
     VALUES (?, 'Work orchestrator', ?, ?, 'opus', 'sessions', 'claude', NULL, 'local',
       'chat', 'ask', 'orchestrator', ?, 1, 'user', datetime('now', '-3 hours'),
       datetime('now', '-1 minutes'))`
  ).run(
    id,
    `claude-${id}`,
    `~/.agent-os/orchestrators/${workspaceId}`,
    workspaceId
  );
  const insert = db.prepare(
    `INSERT INTO chat_items (session_id, item_id, seq, data) VALUES (?, ?, ?, ?)`
  );
  orchestratorConversation(start).forEach((item, i) =>
    insert.run(id, item.id, i + 1, JSON.stringify(item))
  );
  for (const ask of orchestratorAsks({ idem: sessionIds.get("idem")! })) {
    db.prepare(
      `INSERT INTO orchestrator_asks (workspace_id, subject, kind, title, detail, link, sha, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', ?))`
    ).run(
      workspaceId,
      ask.subject,
      ask.kind,
      ask.title,
      ask.detail,
      ask.link,
      ask.sha,
      `-${ask.minutesAgo} minutes`
    );
  }
}

// A machine linked to its own AgentOS: the stand-in in peer.ts.
function seedLinkedMachine(db: Db): void {
  db.prepare(
    `INSERT INTO hosts (id, name, ssh_target, sort_order) VALUES (?, ?, ?, 1)`
  ).run(PEER_HOST.id, PEER_HOST.name, PEER_HOST.ssh);
  db.prepare(
    `INSERT INTO host_links (host_id, url, token) VALUES (?, ?, 'demo')`
  ).run(PEER_HOST.id, `http://127.0.0.1:${PEER_PORT}`);
}

export async function seed(): Promise<void> {
  teardownTmux();
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(SCREENS, { recursive: true });
  fs.mkdirSync(TMUX_TMPDIR, { recursive: true, mode: 0o700 });
  writeHome();
  createRepos();
  await seedDb();
  console.log(`  seeded ${DB_PATH}`);
}

export function teardownTmux(): void {
  try {
    tmux(["kill-server"]);
  } catch {
    // No demo tmux server running.
  }
}

if (require.main === module) {
  seed().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
