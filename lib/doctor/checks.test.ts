import { describe, expect, it } from "vitest";
import type { AgentProbe } from "../agents/probe";
import {
  MIN_NODE_MAJOR,
  checkAgents,
  checkNode,
  runDoctor,
  type ExecFn,
} from "./checks";

const missing = Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });

const execWith =
  (have: Record<string, string>): ExecFn =>
  async (file) => {
    if (!(file in have)) throw missing;
    return { stdout: have[file], stderr: "" };
  };

const ready: AgentProbe = { installed: true, auth: "ready", version: "1.0.0" };
const probeOf = (p: Record<string, AgentProbe>) => async () => p;
const byId = (checks: Awaited<ReturnType<typeof runDoctor>>) =>
  Object.fromEntries(checks.map((c) => [c.id, c]));

describe("checkNode", () => {
  it("passes at the minimum and fails below it", () => {
    expect(checkNode(`${MIN_NODE_MAJOR}.0.0`).status).toBe("ok");
    const old = checkNode(`${MIN_NODE_MAJOR - 1}.9.0`);
    expect(old.status).toBe("fail");
    expect(old.fix).toBeTruthy();
  });
});

describe("runDoctor", () => {
  const all = {
    git: "git version 2.40.0",
    tmux: "tmux 3.4",
    rg: "ripgrep 14.1.0",
    lsof: "lsof version 4.99",
  };

  it("is all ok when everything is there", async () => {
    const checks = await runDoctor(true, {
      exec: execWith(all),
      probe: probeOf({ claude: ready }),
      nodeVersion: "22.1.0",
    });
    expect(checks.map((c) => c.id)).toEqual([
      "node",
      "git",
      "tmux",
      "ripgrep",
      "lsof",
      "agents",
    ]);
    expect(checks.every((c) => c.status === "ok")).toBe(true);
    expect(byId(checks).tmux.detail).toBe("tmux 3.4");
  });

  it("fails what is required and warns about what is optional", async () => {
    const { git, ...rest } = all;
    void git;
    const { rg, ...fewer } = rest;
    void rg;
    const c = byId(
      await runDoctor(true, {
        exec: execWith(fewer),
        probe: probeOf({}),
        nodeVersion: "22.1.0",
      })
    );
    expect(c.git.status).toBe("fail");
    expect(c.git.fix).toMatch(/git$/);
    expect(c.ripgrep.status).toBe("warn");
    expect(c.agents.status).toBe("fail");
  });

  it("turns a failing agent probe into a warning instead of rejecting", async () => {
    const c = byId(
      await runDoctor(true, {
        exec: execWith(all),
        probe: async () => {
          throw new Error("probe blew up");
        },
        nodeVersion: "22.0.0",
      })
    );
    expect(c.agents.status).toBe("warn");
    expect(c.node.status).toBe("ok");
  });

  it("treats a tool that times out as not answering", async () => {
    const exec: ExecFn = async () => {
      throw Object.assign(new Error("timed out"), { killed: true });
    };
    const c = byId(
      await runDoctor(true, {
        exec,
        probe: probeOf({ claude: ready }),
        nodeVersion: "22.0.0",
      })
    );
    expect(c.tmux.status).toBe("fail");
    expect(c.tmux.detail).toContain("did not answer");
  });

  it("accepts lsof that prints its version but exits non-zero", async () => {
    const exec: ExecFn = async (file) => {
      if (file !== "lsof") return { stdout: "x 1.0", stderr: "" };
      throw Object.assign(new Error("exit 1"), { code: 1, stderr: "x" });
    };
    const c = byId(
      await runDoctor(true, {
        exec,
        probe: probeOf({ claude: ready }),
        nodeVersion: "22.0.0",
      })
    );
    expect(c.lsof.status).toBe("ok");
  });
});

describe("checkAgents", () => {
  it("is ok with one signed-in agent, warns when only unsigned, fails with none", () => {
    expect(checkAgents({ claude: ready }).status).toBe("ok");
    expect(
      checkAgents({
        claude: { installed: true, auth: "needs-login" },
        codex: { installed: false, auth: "unknown" },
      }).status
    ).toBe("warn");
    expect(
      checkAgents({ codex: { installed: false, auth: "unknown" } }).status
    ).toBe("fail");
  });
});
