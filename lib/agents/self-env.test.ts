import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureMcpConfig } from "../mcp-config";
import { agentEnv } from "./launch";
import { claimAgentosEnv } from "./self-env";

const KEYS = ["AGENTOS_URL", "AGENTOS_PORT", "AGENTOS_SESSION_ID"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of KEYS)
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
});

describe("claimAgentosEnv", () => {
  it("gives a server started inside another's session its own address", () => {
    // What a test instance inherits from the session that started it.
    process.env.AGENTOS_URL = "http://127.0.0.1:3011";
    process.env.AGENTOS_PORT = "3011";
    process.env.AGENTOS_SESSION_ID = "live-session";
    claimAgentosEnv(3999);

    const own = "http://127.0.0.1:3999";
    const child = JSON.parse(
      execFileSync(process.execPath, [
        "-e",
        `console.log(JSON.stringify([process.env.AGENTOS_URL, process.env.AGENTOS_SESSION_ID ?? null]))`,
      ]).toString()
    );
    expect(child).toEqual([own, null]);

    expect(agentEnv("s1")).toMatchObject({
      AGENTOS_URL: own,
      AGENTOS_SESSION_ID: "s1",
    });

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "self-env-"));
    ensureMcpConfig(dir, "s1");
    const mcp = JSON.parse(
      fs.readFileSync(path.join(dir, ".mcp.json"), "utf8")
    );
    expect(mcp.mcpServers["agent-os"].env.AGENTOS_URL).toBe(own);
    fs.rmSync(dir, { recursive: true });
  });
});
