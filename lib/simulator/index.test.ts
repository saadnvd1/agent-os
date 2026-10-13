import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { db } from "../db";
import { createProject } from "../projects";
import { seedSession } from "../orchestrator/testing";
import {
  openSimulator,
  releaseOnEnd,
  releaseSimulator,
  runSimulator,
  simulatorStatus,
} from "./index";
import { putLease, getLease } from "./lease";
import { setSimctlRunner } from "./simctl";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aos-sim-"));
const projectId = createProject({ name: "sim-app", workingDirectory: dir }).id;
const config = path.join(dir, "agentos.json");
const calls: string[][] = [];

beforeEach(() => {
  db.prepare(`DELETE FROM simulator_leases`).run();
  setSimctlRunner(async (args) => {
    calls.push(args);
    return "";
  });
});
afterEach(() => {
  setSimctlRunner(null);
  calls.length = 0;
  fs.rmSync(config, { force: true });
});

describe("a project with no simulator block", () => {
  it("refuses to open one, saying why", () => {
    const id = seedSession({ projectId, name: "t", task: true });
    expect(() => openSimulator(id)).toThrow(/doesn't declare a simulator/);
    expect(simulatorStatus(id).state).toBe("none");
  });

  it("refuses to drive one", async () => {
    const id = seedSession({ projectId, name: "t", task: true });
    await expect(runSimulator(id, ["snapshot"])).rejects.toThrow(
      /doesn't declare/
    );
  });
});

describe("a task on another machine", () => {
  it("is told its simulator is driven there", () => {
    fs.writeFileSync(config, JSON.stringify({ simulator: { start: "true" } }));
    const id = seedSession({ projectId, name: "t", task: true });
    db.prepare(
      `INSERT OR IGNORE INTO hosts (id, name, ssh_target) VALUES ('h-remote', 'box', 'me@box')`
    ).run();
    db.prepare(`UPDATE sessions SET host_id = 'h-remote' WHERE id = ?`).run(id);
    expect(() => openSimulator(id)).toThrow(/another machine/);
  });
});

describe("a declared simulator", () => {
  const declare = () =>
    fs.writeFileSync(config, JSON.stringify({ simulator: { start: "true" } }));

  it("needs to be opened before it is driven", async () => {
    declare();
    const id = seedSession({ projectId, name: "t", task: true });
    if (process.platform !== "darwin") return;
    await expect(runSimulator(id, ["snapshot"])).rejects.toThrow(
      /aos sim open/
    );
    putLease(id, { name: "n", udid: "U", state: "starting" });
    await expect(runSimulator(id, ["snapshot"])).rejects.toThrow(
      /still starting/
    );
  });

  it("refuses to open past the cap", () => {
    if (process.platform !== "darwin") return;
    declare();
    process.env.AGENTOS_SIMULATOR_MAX = "1";
    try {
      putLease("other", { name: "o", state: "ready" });
      const id = seedSession({ projectId, name: "t", task: true });
      expect(() => openSimulator(id)).toThrow(/already booted/);
      expect(getLease(id)).toBeUndefined();
    } finally {
      delete process.env.AGENTOS_SIMULATOR_MAX;
    }
  });
});

describe("releasing", () => {
  it("does nothing, and asks simctl nothing, for a task with no simulator", async () => {
    releaseOnEnd("nobody", { remove: true });
    await releaseSimulator("nobody", { remove: true });
    expect(calls).toEqual([]);
  });
});
