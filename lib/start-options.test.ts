import { execFileSync } from "child_process";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "./db";
import { setModelSettings } from "./models/config";
import { PROVIDER_PRESETS } from "./models/providers";
import { createProject } from "./projects";
import { TRUST_HEADER } from "./security/auth";
import { tempDir } from "@/lib/test-temp";

vi.mock("./agents/probe", () => ({
  probeAgents: vi.fn(async () => ({
    claude: { installed: true, auth: "ready" },
    codex: { installed: false, auth: "unknown", hint: "Install codex" },
  })),
}));

const { startOptions, UnknownProjectError } = await import("./start-options");
const route = await import("@/app/api/start-options/route");

const repo = tempDir("aos-start-opts-");
execFileSync("git", ["init", "-q", "-b", "trunk"], { cwd: repo });
execFileSync(
  "git",
  [
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@t",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "x",
  ],
  { cwd: repo }
);

const call = (query: string, trust = "device") =>
  route.GET(
    new NextRequest(`http://localhost/api/start-options${query}`, {
      headers: { [TRUST_HEADER]: trust },
    })
  );

beforeEach(() => {
  db.prepare(`DELETE FROM settings WHERE key LIKE 'models%'`).run();
});

describe("start options", () => {
  it("gives the form everything in one answer", async () => {
    const project = createProject({ name: "opts-app", workingDirectory: repo });
    const body = await (await call(`?projectId=${project.id}`)).json();
    expect(body.project).toMatchObject({
      id: project.id,
      name: "opts-app",
      hostId: "local",
    });
    expect(body.git).toMatchObject({
      isGitRepo: true,
      defaultBranch: "trunk",
      currentBranch: "trunk",
      branches: ["trunk"],
    });
    expect(
      body.hosts.find((h: { id: string }) => h.id === "local")
    ).toMatchObject({
      linked: true,
      unavailable: null,
    });
    const claude = body.agents.find(
      (a: { value: string }) => a.value === "claude"
    );
    expect(claude).toMatchObject({
      installed: true,
      auth: "ready",
      defaultModel: "opus",
    });
    expect(claude.models.map((m: { value: string }) => m.value)).toContain(
      "sonnet"
    );
    expect(
      body.agents.find((a: { value: string }) => a.value === "codex")
    ).toMatchObject({
      installed: false,
      hint: "Install codex",
    });
    expect(typeof body.planDefault).toBe("boolean");
    expect(body.roles.plan).toBeTruthy();
    expect(body.roles.implement).toBeTruthy();
  });

  it("follows the saved plan setting", async () => {
    setModelSettings({ planStep: false });
    expect((await startOptions(null)).planDefault).toBe(false);
  });

  it("lists enabled providers' models and leaks no address, key or ssh target", async () => {
    const deepseek = {
      ...PROVIDER_PRESETS.find((p) => p.id === "deepseek")!,
      baseUrl: "https://llm.internal.example",
      auth: { kind: "tokenvault", project: "sekrit-ref" },
      enabled: true,
    };
    setModelSettings({ providers: [deepseek] });
    db.prepare(
      `INSERT OR IGNORE INTO hosts (id, name, ssh_target) VALUES ('h9', 'box', 'me@10.9.8.7')`
    ).run();
    const text = JSON.stringify(await (await call("")).json());
    expect(text).toContain(`"ref":"deepseek/`);
    for (const secret of [
      "llm.internal.example",
      "sekrit-ref",
      "tokenvault",
      "me@10.9.8.7",
      "baseUrl",
      "ssh_target",
    ])
      expect(text).not.toContain(secret);
  });

  it("says a folder that isn't a repository isn't one", async () => {
    const dir = tempDir("aos-start-plain-");
    const project = createProject({ name: "plain", workingDirectory: dir });
    const out = await startOptions(project.id);
    expect(out.git).toMatchObject({
      isGitRepo: false,
      defaultBranch: null,
      branches: [],
    });
  });

  it("refuses an unknown project and takes no project for a scratch chat", async () => {
    await expect(startOptions("nope")).rejects.toBeInstanceOf(
      UnknownProjectError
    );
    expect((await call("?projectId=nope")).status).toBe(404);
    const scratch = await (await call("")).json();
    expect(scratch).toMatchObject({ project: null, git: null });
  });
});
