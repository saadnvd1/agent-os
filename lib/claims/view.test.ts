import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { putSetting } from "@/lib/settings-store";
import { machineId } from "./machine";
import { rememberPeer } from "./peers";
import { upsertLocal, upsertRemote, liveClaims } from "./store";
import { claimsView } from "./view";

const wire = (id: string, origin: string, name: string) => ({
  id,
  origin,
  origin_name: name,
  hops: 0,
  source: "session",
  session_name: null,
  repo: "git.example.test/team/widgets",
  branch: "feature/x",
  base: "main",
  goal: "Add thing",
  files: ["a.ts"],
  files_more: 0,
  pr_url: null,
  ttl_s: 600,
  age_s: 0,
  released: null,
});

beforeEach(() => {
  putSetting("claims.machine_name", "here");
  db.prepare(`DELETE FROM work_claims`).run();
  db.prepare(`DELETE FROM claim_peers`).run();
});

describe("claimsView", () => {
  it("lists this machine first, then peers with when they were last heard", () => {
    upsertLocal(
      { id: machineId(), name: "here" },
      {
        sessionId: "s1",
        sessionName: "x",
        repo: "git.example.test/team/widgets",
        branch: "b",
        base: "main",
        goal: "Mine",
        files: [],
        filesMore: 0,
        prUrl: null,
      }
    );
    upsertRemote(machineId(), "peer-b", wire("c1", "peer-b", "box"), 1_000);
    upsertRemote(machineId(), "peer-c", wire("c2", "peer-c", "pc"), 2_000);
    rememberPeer("host-1", "peer-b", 5_000);
    const view = claimsView(liveClaims({ now: 1_000 }));
    expect(view.machines.map((m) => [m.name, m.self])).toEqual([
      ["here", true],
      ["box", false],
      ["pc", false],
    ]);
    const byName = Object.fromEntries(view.machines.map((m) => [m.name, m]));
    expect(byName.here.lastHeardAt).toBeNull();
    expect(byName.box.lastHeardAt).toBe(5_000);
    expect(byName.pc.lastHeardAt).toBe(2_000);
    expect(typeof view.now).toBe("number");
  });
});
