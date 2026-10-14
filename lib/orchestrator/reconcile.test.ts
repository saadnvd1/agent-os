import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { saveItem } from "../chat/store";
import { putSetting } from "../settings-store";
import { pendingEvents } from "./events";
import { seedSession, seedWorkspace } from "./testing";
import {
  classifyAgentPrs,
  reconcileSweep,
  recordAgentPrs,
  type ReconcileDeps,
} from "./reconcile";

const URL_OWN = "https://github.com/acme/app/pull/7";
const URL_OTHER = "https://github.com/acme/api/pull/17";
const URL_OUTSIDE = "https://github.com/elsewhere/tool/pull/3";

function setup() {
  const { workspace, app, api } = seedWorkspace();
  const task = seedSession({
    projectId: app.id,
    name: "Share links",
    view: "chat",
    task: true,
  });
  return { workspace, app, api, task };
}

const slugs = (): ReconcileDeps["slugOf"] => {
  const byDir: Record<string, string> = {
    "/tmp/app": "acme/app",
    "/tmp/api": "acme/api",
  };
  return async (dir) => byDir[dir] ?? null;
};

const deps = (
  _app: string,
  _api: string,
  view: ReconcileDeps["view"] = async () => ({ state: "OPEN", head: "feat" })
): ReconcileDeps => ({ slugOf: slugs(), view });

let n = 0;
function created(session: string, command: string, output: string) {
  saveItem(session, {
    id: `tool-${++n}`,
    kind: "tool",
    name: "Bash",
    title: command,
    input: { command },
    status: "done",
    output,
    createdAt: Date.now(),
  } as never);
}

const lines = (workspaceId: string) =>
  pendingEvents(workspaceId)
    .filter((e) => e.key.includes("stray-pr:"))
    .map((e) => e.line);

beforeEach(() => {
  db.prepare(`DELETE FROM agent_prs`).run();
  db.prepare(`DELETE FROM chat_items`).run();
  putSetting("reconcile.chat_items_rowid", "0");
});

describe("PRs agents opened", () => {
  it("records the URL a gh pr create printed, and nothing else", () => {
    const { task } = setup();
    created(task, "cd ../api && gh pr create --fill", `${URL_OTHER}\n`);
    created(task, "gh pr view 3", `see ${URL_OUTSIDE}`);
    created(task, "echo hi", "nothing");
    expect(recordAgentPrs()).toBe(1);
    expect(recordAgentPrs()).toBe(0);
    expect(db.prepare(`SELECT url, repo, number FROM agent_prs`).all()).toEqual(
      [{ url: URL_OTHER, repo: "acme/api", number: 17 }]
    );
  });

  it("raises a PR outside the task's repo once, naming the task and URL", async () => {
    const { workspace, app, api, task } = setup();
    created(task, "gh pr create", URL_OTHER);
    recordAgentPrs();
    const d = deps(app.id, api.id);
    expect(await classifyAgentPrs(d)).toBe(1);
    expect(await classifyAgentPrs(d)).toBe(0);
    const [line] = lines(workspace.id);
    expect(line).toContain('Task "Share links" opened a PR outside its repo');
    expect(line).toContain(URL_OTHER);
    expect(line).toContain(`project ${api.name}`);
  });

  it("says when the repo isn't one of the workspace's", async () => {
    const { workspace, app, api, task } = setup();
    created(task, "gh pr create", URL_OUTSIDE);
    recordAgentPrs();
    await classifyAgentPrs(deps(app.id, api.id));
    expect(lines(workspace.id)[0]).toMatch(
      /not a repository of this workspace/
    );
  });

  it("stays quiet for the task's own repo, an owned PR and a closed one", async () => {
    const { workspace, app, api, task } = setup();
    created(task, "gh pr create", URL_OWN);
    created(task, "gh pr create", URL_OTHER);
    created(task, "gh pr create", URL_OUTSIDE);
    recordAgentPrs();
    const owner = seedSession({
      projectId: api.id,
      name: "Own task",
      task: true,
    });
    db.prepare(`UPDATE sessions SET pr_url = ? WHERE id = ?`).run(
      URL_OTHER,
      owner
    );
    await classifyAgentPrs(
      deps(app.id, api.id, async (url) => ({
        state: url === URL_OUTSIDE ? "MERGED" : "OPEN",
        head: "feat",
      }))
    );
    expect(lines(workspace.id)).toEqual([]);
    expect(
      db
        .prepare(`SELECT COUNT(*) AS n FROM agent_prs WHERE told_at IS NULL`)
        .get()
    ).toEqual({ n: 0 });
  });

  it("looks again when the PR can't be read", async () => {
    const { workspace, app, api, task } = setup();
    created(task, "gh pr create", "https://github.com/acme/api/pull/18");
    recordAgentPrs();
    await classifyAgentPrs(deps(app.id, api.id, async () => null));
    expect(lines(workspace.id)).toEqual([]);
    await classifyAgentPrs(deps(app.id, api.id));
    expect(lines(workspace.id)).toHaveLength(1);
  });

  it("the sweep is throttled", async () => {
    const { app, api, task } = setup();
    created(task, "gh pr create", URL_OTHER);
    const d = deps(app.id, api.id);
    const now = Date.now() + 10 * 60_000;
    await reconcileSweep(now, d);
    created(task, "gh pr create", URL_OUTSIDE);
    await reconcileSweep(now + 1000, d);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM agent_prs`).get()).toEqual({
      n: 1,
    });
    await reconcileSweep(now + 3 * 60_000, d);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM agent_prs`).get()).toEqual({
      n: 2,
    });
  });
});
