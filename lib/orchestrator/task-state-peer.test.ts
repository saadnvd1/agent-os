import { randomUUID } from "crypto";
import { afterEach, describe, expect, it } from "vitest";
import { getDb, type Session } from "../db";
import { fakePeer } from "../__fixtures__/fake-peer";
import { linkedHost } from "../__fixtures__/linked-host";
import { waitingState } from "./task-state";

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

// A task running on a linked machine: its screen is that machine's to read.
async function remoteTask(lines?: string[]) {
  const peer = await fakePeer("tok");
  const host = linkedHost(peer.url, "tok");
  cleanups.push(peer.close, host.remove);
  const id = randomUUID();
  if (lines) peer.routes[`/api/sessions/${id}/preview`] = () => ({ lines });
  getDb()
    .prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory, host_id, task_status) VALUES (?, 't', 'main', '/tmp', ?, 'running')`
    )
    .run(id, host.hostId);
  return getDb()
    .prepare(`SELECT * FROM sessions WHERE id = ?`)
    .get(id) as Session;
}

describe("waitingState for a task on a linked machine", () => {
  it("sees a BLOCKED: line on its screen there", async () => {
    const task = await remoteTask(["working", "BLOCKED: need the prod key"]);
    expect((await waitingState(task)).blocked).toContain("need the prod key");
  });

  it("clears a screen that machine reads as clean", async () => {
    const task = await remoteTask(["all done, PR is up"]);
    expect((await waitingState(task)).blocked).toBeNull();
  });

  it("never clears a screen it couldn't read", async () => {
    expect((await waitingState(await remoteTask())).blocked).toContain(
      "couldn't be read"
    );
    expect((await waitingState(await remoteTask([]))).blocked).toContain(
      "couldn't be read"
    );
  });
});
