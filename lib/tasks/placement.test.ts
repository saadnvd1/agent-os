import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import type { MachineView } from "./schedule";
import {
  heavyNeeds,
  inferNeeds,
  meetsNeeds,
  needsFromBrief,
  needsFromSetting,
  needsOf,
  place,
  unplaceable,
  type PeerOption,
} from "./placement";

const NOW = Date.parse("2026-10-14T15:00:00Z");

const view = (over: Partial<MachineView> = {}): MachineView => ({
  label: "this machine",
  enabled: true,
  reading: false,
  level: "green",
  settled: true,
  settleLeftMs: 0,
  booted: 0,
  maxBooted: 2,
  heavyStarting: 0,
  lastAutoStartAt: null,
  lastHeavyStartAt: null,
  ...over,
});

const peer = (hostId: string, over: Partial<PeerOption> = {}): PeerOption => ({
  hostId,
  name: hostId,
  view: view({ label: hostId }),
  capabilities: ["linux"],
  hasProject: true,
  loadPerCore: 0.2,
  ...over,
});

const task = (over = {}) => ({
  heavy: false,
  needsUnmet: false,
  remote: false,
  priority: "normal" as const,
  ...over,
});

const red = () => view({ level: "red", settled: false });

describe("place", () => {
  it("starts at home when the home machine is green", () => {
    expect(place(task(), view(), [peer("box")], [], NOW)).toBeNull();
  });

  it("sends a task to a green peer when the home machine is red", () => {
    expect(place(task(), red(), [peer("box")], [], NOW)).toEqual({
      hostId: "box",
      name: "box",
      why: "this machine load red",
    });
  });

  it("holds when the only peer's reading is stale", () => {
    const stale = peer("box", {
      view: view({ label: "box", level: "red", settled: false }),
    });
    expect(place(task(), red(), [stale], [], NOW)).toBeNull();
  });

  it("holds when the peer is red or still settling", () => {
    const busy = peer("box", { view: view({ level: "red", settled: false }) });
    const settling = peer("box2", { view: view({ settled: false }) });
    expect(place(task(), red(), [busy, settling], [], NOW)).toBeNull();
  });

  it("never places work that needs a Mac, however red the host", () => {
    const ios = task({ needsUnmet: false, heavy: true });
    expect(
      place(ios, red(), [peer("box")], ["mac", "xcode", "simulator"], NOW)
    ).toBeNull();
  });

  it("skips a peer that doesn't have the project", () => {
    expect(
      place(task(), red(), [peer("box", { hasProject: false })], [], NOW)
    ).toBeNull();
  });

  it("takes the least loaded of several green peers, then the id", () => {
    const got = place(
      task(),
      red(),
      [
        peer("b", { loadPerCore: 0.4 }),
        peer("c", { loadPerCore: 0.1 }),
        peer("a", { loadPerCore: 0.1 }),
      ],
      [],
      NOW
    );
    expect(got?.hostId).toBe("a");
  });

  it("leaves a task already on a linked machine, and one without a reading, alone", () => {
    expect(
      place(task({ remote: true }), red(), [peer("box")], [], NOW)
    ).toBeNull();
    expect(
      place(
        task(),
        view({ reading: true, level: "green", settled: false }),
        [peer("box")],
        [],
        NOW
      )
    ).toBeNull();
  });

  it("moves a task that needs a simulator off a full home to a peer that can", () => {
    const full = view({ booted: 2 });
    const mac = peer("mac2", { capabilities: ["mac", "xcode", "simulator"] });
    expect(
      place(
        task({ heavy: true }),
        full,
        [peer("box"), mac],
        ["mac", "xcode", "simulator"],
        NOW
      )?.hostId
    ).toBe("mac2");
  });
});

describe("what a task needs", () => {
  const dirs: string[] = [];
  const project = (files: Record<string, string | null>) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "needs-"));
    dirs.push(dir);
    for (const [name, body] of Object.entries(files)) {
      const p = path.join(dir, name);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      if (body === null) fs.mkdirSync(p, { recursive: true });
      else fs.writeFileSync(p, body);
    }
    return dir;
  };
  afterEach(() => {
    for (const d of dirs.splice(0))
      fs.rmSync(d, { recursive: true, force: true });
  });

  it("reads a request's setting", () => {
    expect(needsFromSetting("mac")).toEqual(["mac"]);
    expect(needsFromSetting("any")).toEqual([]);
    expect(needsFromSetting(["xcode", "bogus"])).toEqual(["xcode"]);
    expect(needsFromSetting(undefined)).toBeNull();
  });

  it("reads a tag line in the brief", () => {
    expect(needsFromBrief("Fix it.\nmachine: mac\n")).toEqual(["mac"]);
    expect(needsFromBrief("needs: simulator, xcode")).toEqual([
      "simulator",
      "xcode",
    ]);
    expect(needsFromBrief("machine: any")).toEqual([]);
    expect(needsFromBrief("the machine: broken, fix")).toBeNull();
    expect(needsFromBrief("nothing here")).toBeNull();
  });

  it("infers iOS work from an Xcode project or an Expo ios section", () => {
    expect(inferNeeds(project({ "ios/App.xcodeproj": null }))).toEqual([
      "mac",
      "xcode",
      "simulator",
    ]);
    expect(inferNeeds(project({ "app.json": '{"expo":{"ios":{}}}' }))).toEqual([
      "mac",
      "xcode",
      "simulator",
    ]);
    expect(inferNeeds(project({ "package.json": "{}" }))).toEqual([]);
  });

  it("task setting beats the brief beats the project's file", () => {
    const dir = project({ "agentos.json": '{"machine":{"needs":["xcode"]}}' });
    const input = {
      projectId: "p-none",
      projectPath: dir,
      prompt: "machine: mac",
    };
    expect(needsOf({ ...input, setting: "any" })).toEqual({
      needs: [],
      source: "task",
    });
    expect(needsOf(input)).toEqual({ needs: ["mac"], source: "brief" });
    expect(needsOf({ ...input, prompt: "plain" })).toEqual({
      needs: ["xcode"],
      source: "config",
    });
  });

  it("treats a simulator block in agentos.json as iOS work", () => {
    const dir = project({
      "agentos.json": '{"simulator":{"start":"./run-sim.sh"}}',
    });
    expect(
      needsOf({ projectId: "p-none", projectPath: dir, prompt: "x" }).needs
    ).toEqual(["mac", "xcode", "simulator"]);
  });

  it("matches needs to what a machine reports", () => {
    expect(meetsNeeds([], ["linux"])).toBe(true);
    expect(meetsNeeds(["mac"], ["linux"])).toBe(false);
    expect(meetsNeeds(["mac", "xcode"], ["mac", "xcode", "simulator"])).toBe(
      true
    );
    expect(heavyNeeds(["simulator"])).toBe(true);
    expect(heavyNeeds(["mac"])).toBe(false);
  });

  it("keeps plan-only, orchestrator, pinned and non-claude tasks at home", () => {
    const base = {
      plan_only: null,
      plan: null,
      agent_type: "claude",
      model_overrides: null,
      origin_workspace_id: null,
      host_id: null,
    };
    expect(unplaceable(base)).toBeNull();
    expect(unplaceable({ ...base, plan_only: 1 })).toMatch(/plan-only/);
    expect(unplaceable({ ...base, plan: 1 })).toMatch(/plan-first/);
    expect(unplaceable({ ...base, origin_workspace_id: "w" })).toMatch(
      /orchestrator/
    );
    expect(unplaceable({ ...base, host_id: "h" })).toMatch(/pinned/);
    expect(unplaceable({ ...base, agent_type: "codex" })).toMatch(/Claude/);
  });
});
