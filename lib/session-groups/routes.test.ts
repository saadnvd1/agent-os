import { describe, expect, it } from "vitest";
import { db, insertSessionRow } from "@/lib/db";
import { createProject } from "@/lib/projects";
import { createWorkspace, setProjectWorkspace } from "@/lib/workspaces";
import { GET as list, POST as create } from "@/app/api/session-groups/route";
import {
  DELETE as remove,
  PATCH as patch,
} from "@/app/api/session-groups/[id]/route";
import { POST as restore } from "@/app/api/session-groups/[id]/restore/route";
import { POST as order } from "@/app/api/session-groups/order/route";
import { POST as join } from "@/app/api/sessions/[id]/group/route";
import { POST as joinMany } from "@/app/api/sessions/group/route";
import { GET as sessions } from "@/app/api/sessions/route";

const req = (body?: unknown) =>
  new Request("http://localhost/x", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function setup() {
  const w = createWorkspace(`ws-${Math.random()}`);
  const p = createProject({
    name: `p-${Math.random()}`,
    workingDirectory: "/tmp",
  });
  setProjectWorkspace(p.id, w.id);
  const id = `s-${Math.random()}`;
  insertSessionRow(db, { id, name: id, tmux_name: id, project_id: p.id });
  return { w, id };
}

describe("session group routes", () => {
  it("creates, lists, renames, folds, orders, deletes and restores", async () => {
    const { w } = setup();
    const made = await create(req({ name: "Launch", workspaceId: w.id }));
    expect(made.status).toBe(200);
    const { sessionGroup } = await made.json();
    expect(
      (await create(req({ name: "launch", workspaceId: w.id }))).status
    ).toBe(409);
    expect((await create(req({ workspaceId: w.id }))).status).toBe(400);
    expect((await create(req({ name: "x" }))).status).toBe(400);

    const listed = await (await list()).json();
    expect(listed.sessionGroups.map((g: { id: string }) => g.id)).toContain(
      sessionGroup.id
    );

    const folded = await patch(req({ collapsed: true }), ctx(sessionGroup.id));
    expect((await folded.json()).sessionGroup.collapsed).toBe(true);
    expect(
      (await patch(req({ collapsed: "yes" }), ctx(sessionGroup.id))).status
    ).toBe(400);
    expect((await patch(req({ name: "A" }), ctx("missing"))).status).toBe(404);

    const ordered = await order(
      req({ workspaceId: w.id, ids: [sessionGroup.id] })
    );
    expect(ordered.status).toBe(200);

    expect((await remove(req(), ctx(sessionGroup.id))).status).toBe(200);
    expect((await remove(req(), ctx(sessionGroup.id))).status).toBe(409);
    expect((await restore(req(), ctx(sessionGroup.id))).status).toBe(200);
  });

  it("files a session, refuses another workspace's group, and returns groups with the list", async () => {
    const { w, id } = setup();
    const other = setup().w;
    const mine = (
      await (await create(req({ name: "Mine", workspaceId: w.id }))).json()
    ).sessionGroup;
    const theirs = (
      await (
        await create(req({ name: "Theirs", workspaceId: other.id }))
      ).json()
    ).sessionGroup;

    expect((await join(req({ groupId: mine.id }), ctx(id))).status).toBe(200);
    expect((await join(req({ groupId: theirs.id }), ctx(id))).status).toBe(409);
    expect((await join(req({}), ctx(id))).status).toBe(400);
    expect((await join(req({ groupId: null }), ctx("missing"))).status).toBe(
      404
    );

    expect((await joinMany(req({ ids: [id], groupId: mine.id }))).status).toBe(
      200
    );
    expect((await joinMany(req({ ids: [], groupId: mine.id }))).status).toBe(
      400
    );

    const body = await (await sessions()).json();
    expect(body.groups).toBeUndefined();
    expect(body.sessionGroups.map((g: { id: string }) => g.id)).toContain(
      mine.id
    );
    expect(
      body.sessions.find((s: { id: string }) => s.id === id).session_group_id
    ).toBe(mine.id);
  });
});
