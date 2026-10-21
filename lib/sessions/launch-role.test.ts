import fs from "fs";
import http from "http";
import path from "path";
import type { AddressInfo } from "net";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const home = vi.hoisted(() =>
  process.env.DB_PATH!.replace(/[^/]+$/, "home-role")
);
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>();
  const homedir = () => home;
  return { ...actual, homedir, default: { ...actual, homedir } };
});
vi.mock("../chat/runner", () => ({ sendQueuedNow: async () => {} }));

import { db, type Session } from "../db";
import { createProject } from "../projects";
import { setModelSettings } from "../models/config";
import { clearAvailability } from "../models/availability";
import { ModelUnavailableError } from "../models/agent-binding";
import { launchSession } from "./launch";
import { crewMembers } from "./crew";
import { tempDir } from "@/lib/test-temp";

const row = (id: string) =>
  db.prepare(`SELECT * FROM session_rows WHERE id = ?`).get(id) as Session;

let server: http.Server;
let port: number;
let piFile: string;

function writePi(url: string) {
  fs.writeFileSync(
    piFile,
    JSON.stringify({
      providers: { local: { baseUrl: url, models: [{ id: "qwen3-27b" }] } },
    })
  );
}

beforeAll(async () => {
  server = http.createServer((_q, r) => r.end("{}"));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
  piFile = path.join(tempDir("aos-pi-"), "models.json");
  vi.stubEnv("AGENTOS_PI_MODELS_FILE", piFile);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await new Promise((r) => server.close(r));
});
beforeEach(() => {
  clearAvailability();
  db.prepare(`DELETE FROM settings WHERE key LIKE 'models%'`).run();
  writePi(`http://127.0.0.1:${port}/v1`);
});

const project = () =>
  createProject({
    name: `p-${Math.random()}`,
    workingDirectory: tempDir("aos-role-"),
  });

describe("a session started in a role", () => {
  it("runs a Pi model on the Pi agent, with its brief, role and a crew of its own", async () => {
    setModelSettings({ roles: { implement: "pi/local/qwen3-27b" } });
    const p = project();
    const { session } = await launchSession({
      projectId: p.id,
      agentType: "claude",
      prompt: "add retry",
      agentRole: "developer",
    });
    expect(row(session.id)).toMatchObject({
      agent_type: "pi",
      model: "local/qwen3-27b",
      agent_role: "developer",
      crew_id: session.id,
    });
    expect(row(session.id).system_prompt).toMatch(/Developer in this crew/);
  });

  it("starts the Analyst on its Claude default and joins the named crew", async () => {
    const p = project();
    const dev = (
      await launchSession({
        projectId: p.id,
        agentType: "claude",
        agentRole: "developer",
      })
    ).session;
    const { session } = await launchSession({
      projectId: p.id,
      agentType: "claude",
      agentRole: "analyst",
      crewId: dev.id,
    });
    expect(row(session.id)).toMatchObject({
      agent_type: "claude",
      model: "claude-opus-5-5",
      agent_role: "analyst",
      crew_id: dev.id,
    });
    expect(
      crewMembers(dev.id)
        .map((m) => m.agentRole)
        .sort()
    ).toEqual(["analyst", "developer"]);
  });

  it("lets one session pick a different model than the binding", async () => {
    setModelSettings({ roles: { implement: "pi/local/qwen3-27b" } });
    const { session } = await launchSession({
      projectId: project().id,
      agentType: "claude",
      agentRole: "developer",
      model: "anthropic/claude-opus-5-5",
    });
    expect(row(session.id)).toMatchObject({
      agent_type: "claude",
      model: "claude-opus-5-5",
    });
  });

  it("refuses to start when the local model's server is down, and says what to do", async () => {
    setModelSettings({ roles: { implement: "pi/local/qwen3-27b" } });
    writePi("http://127.0.0.1:9/v1");
    const count = () =>
      (db.prepare(`SELECT COUNT(*) n FROM sessions`).get() as { n: number }).n;
    const before = count();
    const err = await launchSession({
      projectId: project().id,
      agentType: "claude",
      agentRole: "developer",
    }).catch((e) => e);
    expect(count()).toBe(before);
    expect(err).toBeInstanceOf(ModelUnavailableError);
    expect(err).toMatchObject({
      code: "model_unavailable",
      role: "developer",
      ref: "pi/local/qwen3-27b",
    });
    expect(err.fallback).toBeUndefined();
  });

  it("starts on the role's fallback only when asked, never on its own", async () => {
    setModelSettings({
      roles: { implement: "pi/local/qwen3-27b" },
      fallbacks: { implement: "anthropic/claude-sonnet-5-5" },
    });
    writePi("http://127.0.0.1:9/v1");
    const p = project();
    const err = await launchSession({
      projectId: p.id,
      agentType: "claude",
      agentRole: "developer",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ModelUnavailableError);
    expect(err.fallback).toBe("anthropic/claude-sonnet-5-5");
    const { session } = await launchSession({
      projectId: p.id,
      agentType: "claude",
      agentRole: "developer",
      useFallback: true,
    });
    expect(row(session.id)).toMatchObject({
      agent_type: "claude",
      model: "claude-sonnet-5-5",
    });
  });
});
