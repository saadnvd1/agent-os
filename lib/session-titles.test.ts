import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaudeRunner } from "./orchestrator/claude-cli";

// Renaming tries tmux; no tmux here.
vi.mock("@/lib/hosts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hosts")>()),
  hostExec: async () => ({ stdout: "", stderr: "" }),
}));

const { db } = await import("./db");
const { seedSession } = await import("./orchestrator/testing");
const { createProject } = await import("./projects");
const { PATCH } = await import("@/app/api/sessions/[id]/route");
const t = await import("./session-titles");

const project = createProject({
  name: `p-${randomUUID().slice(0, 6)}`,
  workingDirectory: "/tmp/p",
});

const row = (id: string) =>
  db.prepare(`SELECT name, name_source FROM sessions WHERE id = ?`).get(id) as {
    name: string;
    name_source: string;
  };

const answering =
  (title: unknown): ClaudeRunner =>
  async () => ({ title });
const failing: ClaudeRunner = async () => {
  throw new Error("not signed in");
};

function briefFile(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "brief-"));
  const file = path.join(dir, "web-perf-brief.md");
  fs.writeFileSync(file, content);
  return file;
}

beforeEach(() => {
  process.env.AGENTOS_SESSION_TITLES = "on";
});
afterEach(() => {
  process.env.AGENTOS_SESSION_TITLES = "off";
});

describe("the fallback title", () => {
  it("strips the filler from the prompt's first sentence", () => {
    expect(
      t.strippedSentence(
        "Please can you audit the web performance of the dashboard. Then open a PR."
      )
    ).toBe("Audit the web performance of the dashboard");
    expect(t.strippedSentence("Can you fix Send now delivery?")).toBe(
      "Fix Send now delivery"
    );
  });

  it("names a bare brief pointer after its file", () => {
    expect(
      t.strippedSentence(
        "Read and execute the brief at /tmp/fix-chat.md. Run /do-code-review before the PR."
      )
    ).toBe("Fix chat");
  });

  it("finds the brief a prompt points at", () => {
    expect(t.briefPathIn("Read and execute the brief at /tmp/x.md. Go")).toBe(
      "/tmp/x.md"
    );
    expect(t.briefPathIn("Follow docs/plans/stacks.md please")).toBe(
      "docs/plans/stacks.md"
    );
    expect(t.briefPathIn("Fix the sidebar")).toBeNull();
  });

  it("takes the brief's first heading, without its byline", () => {
    expect(
      t.briefHeading(
        "Some preamble\n# Descriptive session names (Saad, 2026-10-07)\n\nOne PR."
      )
    ).toBe("Descriptive session names");
    expect(t.briefHeading("## Only a subheading\ntext")).toBeNull();
  });

  it("prefers the brief's heading, then the sentence, then truncation", () => {
    expect(t.fallbackTitle("Read the brief at /tmp/a.md", "# Web perf\n")).toBe(
      "Web perf"
    );
    expect(t.fallbackTitle("Please fix the flaky upload test.", null)).toBe(
      "Fix the flaky upload test"
    );
    expect(t.fallbackTitle("Please. ".repeat(3) + "x".repeat(80), null)).toBe(
      t.truncatedTitle("Please. ".repeat(3) + "x".repeat(80))
    );
  });

  it("accepts only a short title from the model", () => {
    expect(t.cleanTitle('"Web performance audit."')).toBe(
      "Web performance audit"
    );
    expect(t.cleanTitle("fix send now delivery")).toBe("Fix send now delivery");
    expect(t.cleanTitle("Audit")).toBeNull();
    expect(t.cleanTitle("one two three four five six seven")).toBeNull();
    expect(t.cleanTitle(42)).toBeNull();
  });
});

describe("naming a session from its prompt", () => {
  const settle = () => new Promise((r) => setTimeout(r, 20));

  it("starts with the brief's heading and takes the generated title", async () => {
    const file = briefFile("# Web performance (Saad)\n\nMake it fast.\n");
    const naming = t.nameFor(
      `Read and execute the brief at ${file}. Run /do-code-review.`,
      "/tmp",
      undefined,
      answering(`Web perf audit ${randomUUID().slice(0, 4)}`)
    );
    expect(naming.name).toMatch(/^Web performance( \d+)?$/);
    expect(naming.source).toBe("default");
    const id = seedSession({ projectId: project.id, name: naming.name });
    naming.refine!(id);
    await settle();
    expect(row(id).name).toMatch(/^Web perf audit /);
    expect(row(id).name_source).toBe("generated");
  });

  it("keeps the placeholder when generation fails", async () => {
    const tag = randomUUID().slice(0, 6);
    const naming = t.nameFor(
      `Please fix the upload test ${tag}.`,
      "/tmp",
      undefined,
      failing
    );
    expect(naming.name).toBe(`Fix the upload test ${tag}`);
    const id = seedSession({ projectId: project.id, name: naming.name });
    naming.refine!(id);
    await settle();
    expect(row(id).name).toBe(`Fix the upload test ${tag}`);
  });

  it("keeps the placeholder when the model's answer isn't a title", async () => {
    const tag = randomUUID().slice(0, 6);
    const naming = t.nameFor(
      `Fix the build ${tag}`,
      "/tmp",
      undefined,
      answering("x")
    );
    const id = seedSession({ projectId: project.id, name: naming.name });
    naming.refine!(id);
    await settle();
    expect(row(id).name).toBe(`Fix the build ${tag}`);
  });

  it("uses an explicit name as given, and never refines it", () => {
    const naming = t.nameFor(
      "Read the brief at /tmp/x.md",
      "/tmp",
      " Nightly audit "
    );
    expect(naming).toEqual({ name: "Nightly audit", source: "user" });
  });

  it("numbers a title another live session already has", () => {
    const name = `Same title ${randomUUID().slice(0, 4)}`;
    seedSession({ projectId: project.id, name });
    const id = seedSession({ projectId: project.id, name: "placeholder x" });
    expect(t.applyTitle(id, "placeholder x", name)).toBe(true);
    expect(row(id).name).toBe(`${name} 2`);
  });

  it("never renames a session someone named meanwhile", async () => {
    const tag = randomUUID().slice(0, 6);
    const id = seedSession({ projectId: project.id, name: `Fix it ${tag}` });
    const res = await PATCH(
      new NextRequest(`http://127.0.0.1:3011/api/sessions/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: `My name ${tag}` }),
      }),
      { params: Promise.resolve({ id }) }
    );
    expect(res.status).toBe(200);
    expect(row(id).name_source).toBe("user");
    expect(t.applyTitle(id, `My name ${tag}`, "Generated title here")).toBe(
      false
    );
    expect(row(id).name).toBe(`My name ${tag}`);
  });
});

describe("naming a chat from its first message", () => {
  it("names a default chat after its first message", async () => {
    const id = seedSession({
      projectId: project.id,
      name: `Session ${Math.floor(Math.random() * 1e9)}`,
      view: "chat",
    });
    const title = `Sidebar spacing fix ${randomUUID().slice(0, 4)}`;
    await t.titleChatFromMessage(
      id,
      "the sidebar rows are too tall on phones",
      answering(title)
    );
    expect(row(id)).toEqual({ name: title, name_source: "generated" });
  });

  it("falls back to the message when generation fails", async () => {
    const id = seedSession({
      projectId: project.id,
      name: `Session ${Math.floor(Math.random() * 1e9)}`,
      view: "chat",
    });
    const tag = randomUUID().slice(0, 6);
    await t.titleChatFromMessage(
      id,
      `Can you tidy the README ${tag}?`,
      failing
    );
    expect(row(id).name).toBe(`Tidy the README ${tag}`);
  });

  it("leaves a chat someone named alone", async () => {
    const name = `Session ${Math.floor(Math.random() * 1e9)}`;
    const id = seedSession({ projectId: project.id, name, view: "chat" });
    db.prepare(`UPDATE sessions SET name_source = 'user' WHERE id = ?`).run(id);
    await t.titleChatFromMessage(id, "anything", answering("Should not apply"));
    expect(row(id).name).toBe(name);
  });

  it("leaves a chat that already has a real name alone", async () => {
    const id = seedSession({
      projectId: project.id,
      name: "orchestrator",
      view: "chat",
    });
    await t.titleChatFromMessage(id, "anything", answering("Should not apply"));
    expect(row(id).name).toBe("orchestrator");
  });
});
