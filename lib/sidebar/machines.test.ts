import { describe, expect, it } from "vitest";
import type { Session } from "@/lib/db/types";
import { remoteBlocks } from "@/lib/hosts/remote-menu";
import { buildShelves } from "./shelves";
import { machineGroups, onMachineOnly } from "./machines";

const s = (id: string, extra: Partial<Session> = {}): Session =>
  ({
    id,
    name: id,
    host_id: "local",
    project_id: "p",
    role: null,
    task_prompt: null,
    archived_at: null,
    pinned: false,
    conductor_session_id: null,
    worker_status: null,
    created_at: "2026-10-10 10:00:00",
    updated_at: "2026-10-10 10:00:00",
    ...extra,
  }) as Session;

const linked = { box: "homelab" };
const input = (sessions: Session[]) => ({
  sessions,
  statuses: { mapped: { status: "running" } },
  tasks: {},
  projectName: () => "",
});

describe("a linked machine's sessions in the sidebar", () => {
  const sessions = [
    s("here"),
    s("mapped", { host_id: "box", project_id: "p", peer_mirror: 1 }),
    s("loose", { host_id: "box", project_id: null, peer_mirror: 1 }),
    s("unlinked", { host_id: "ssh-only", project_id: null, peer_mirror: 1 }),
    // Started here over ssh on a linked machine: this machine's own.
    s("ssh", { host_id: "box", project_id: null }),
  ];

  it("sits with its project's sessions when its folder maps to one", () => {
    const shelved = sessions.filter((x) => !onMachineOnly(x, linked));
    const shelves = buildShelves({ ...input(shelved) });
    // The same rows (and so the same row component and menu) as local ones.
    expect(shelves.working.map((r) => r.session.id)).toEqual(["mapped"]);
    expect(shelves.done.map((r) => r.session.id)).toContain("here");
    expect(shelved.map((x) => x.id)).not.toContain("loose");
  });

  it("is listed under its machine otherwise", () => {
    const groups = machineGroups(input(sessions), linked);
    expect(groups).toEqual([
      {
        hostId: "box",
        name: "homelab",
        rows: [expect.objectContaining({ session: sessions[2] })],
      },
    ]);
  });

  it("leaves a machine with nothing loose out", () => {
    expect(machineGroups(input([sessions[1]]), linked)).toEqual([]);
  });
});

describe("remoteBlocks", () => {
  it("gives every action that can't reach the machine its reason", () => {
    const blocks = remoteBlocks(
      s("x", { host_id: "box", peer_mirror: 1 }),
      (id) => (id === "box" ? "homelab" : undefined)
    );
    expect(blocks).toEqual({
      fork: "Runs on homelab: fork it there",
      freshStart: "Runs on homelab: start fresh there",
      moveToProject: "Its project follows its folder on homelab",
      schedule: "Check-ins can't message homelab yet",
    });
  });

  it("blocks nothing on this machine, an unlinked one, a task mirror, or an ssh start", () => {
    const name = (id: string) => (id === "box" ? "homelab" : undefined);
    expect(remoteBlocks(s("x"), name)).toBeNull();
    expect(
      remoteBlocks(s("x", { host_id: "ssh-only", peer_mirror: 1 }), name)
    ).toBeNull();
    expect(
      remoteBlocks(
        s("x", { host_id: "box", task_prompt: "go", peer_mirror: 1 }),
        name
      )
    ).toBeNull();
    // Started here over ssh: its own menu.
    expect(remoteBlocks(s("x", { host_id: "box" }), name)).toBeNull();
  });
});
