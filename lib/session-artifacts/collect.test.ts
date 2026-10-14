import { execFileSync } from "child_process";
import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import type { ChatItem } from "@/lib/chat/events";
import { saveItem } from "@/lib/chat/store";
import * as listRoute from "@/app/api/sessions/[id]/artifacts/route";
import * as oneRoute from "@/app/api/sessions/[id]/artifacts/[artifactId]/route";
import { collectArtifacts, keepSessionFiles, getSession } from "./collect";
import type { SessionArtifact } from "./types";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, stdio: "pipe" });

function repo(): string {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "aos-art-"))
  );
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "t");
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src/a.ts"), "export const a = 1;\n");
  fs.writeFileSync(path.join(dir, ".gitignore"), ".agentos/\n");
  git(dir, "add", ".");
  git(dir, "commit", "-qm", "init");
  return dir;
}

function session(dir: string, pr = true) {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory, worktree_path, pr_url, pr_number, pr_status)
       VALUES (?, 'art', ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      `claude-${id}`,
      dir,
      dir,
      pr ? "https://github.com/o/r/pull/9" : null,
      pr ? 9 : null,
      pr ? "merged" : null
    );
  let at = 0;
  const add = (i: object) =>
    saveItem(id, { id: randomUUID(), createdAt: ++at, ...i } as ChatItem);
  const write = (file: string, name = "Write") =>
    add({
      kind: "tool",
      name,
      title: name,
      status: "done",
      input: { file_path: file, content: "x".repeat(50_000) },
    });
  return { id, add, write };
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const one = (id: string, artifactId: string) =>
  oneRoute.GET(new Request("http://localhost/x"), {
    params: Promise.resolve({ id, artifactId }),
  });
async function list(id: string): Promise<SessionArtifact[]> {
  const res = await listRoute.GET(new Request("http://localhost/x"), ctx(id));
  expect(res.status).toBe(200);
  return (await res.json()).artifacts;
}
const byName = (all: SessionArtifact[], name: string) =>
  all.find((a) => a.name === name)!;

describe("session artifacts", () => {
  it("lists what the session made and serves each by id", async () => {
    const dir = repo();
    const s = session(dir);
    fs.mkdirSync(path.join(dir, ".agentos"));
    fs.writeFileSync(path.join(dir, ".agentos/plan.md"), "# The plan\n");
    fs.writeFileSync(
      path.join(dir, ".agentos/mockup.html"),
      "<html><body>hi</body></html>"
    );
    fs.writeFileSync(path.join(dir, "shot.png"), PNG);
    fs.writeFileSync(path.join(dir, "src/a.ts"), "export const a = 2;\n");
    fs.writeFileSync(path.join(dir, "out.txt"), "made by a shell\n");
    fs.writeFileSync(path.join(dir, ".env"), "TOKEN=1\n");
    s.write(".agentos/plan.md");
    s.write(".agentos/mockup.html");
    s.write("src/a.ts", "Edit");
    s.write("src/a.ts", "Edit");
    s.write(".env");
    s.add({
      kind: "tool",
      name: "mcp__chrome-devtools__take_screenshot",
      title: "s",
      status: "done",
      input: { filePath: path.join(dir, "shot.png") },
    });
    s.add({
      kind: "user",
      text: "look",
      images: [{ mediaType: "image/png", data: PNG.toString("base64") }],
    });

    const all = await list(s.id);
    expect(all.map((a) => a.kind)).toEqual([
      "plan",
      "pr",
      "file",
      "file",
      "file",
      "image",
      "image",
    ]);
    expect(all.some((a) => a.path?.endsWith(".env"))).toBe(false);
    expect(byName(all, "a.ts")).toMatchObject({
      edits: 2,
      state: "live",
      folder: "src",
    });
    expect(byName(all, "out.txt").folder).toBe("");
    expect(byName(all, "out.txt")).toMatchObject({
      by: "shell",
      state: "live",
    });
    expect(byName(all, "Attached image")).toMatchObject({
      by: "you",
      preview: "image",
    });

    const plan = await one(s.id, byName(all, "Plan").id);
    expect(plan.headers.get("content-type")).toBe(
      "text/markdown; charset=utf-8"
    );
    expect(plan.headers.get("content-security-policy")).toContain("sandbox");
    expect(await plan.text()).toBe("# The plan\n");

    const page = await one(s.id, byName(all, "mockup.html").id);
    expect(page.headers.get("content-security-policy")).toContain(
      "sandbox allow-scripts"
    );
    expect(page.headers.get("content-security-policy")).not.toContain(
      "allow-same-origin"
    );

    const shot = await one(s.id, byName(all, "shot.png").id);
    expect(shot.headers.get("content-type")).toBe("image/png");
    const attached = await one(s.id, byName(all, "Attached image").id);
    expect(Buffer.from(await attached.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it("never reads a large Write's content to list it", async () => {
    const dir = repo();
    const s = session(dir, false);
    s.write("big.md");
    const rows = getDb()
      .prepare(
        `SELECT json_extract(data, '$.input.file_path') AS f FROM chat_items WHERE session_id = ?`
      )
      .all(s.id);
    expect(rows).toEqual([{ f: "big.md" }]);
    const all = await collectArtifacts(getSession(s.id)!);
    expect(JSON.stringify(all)).not.toContain("xxxxxxxx");
  });

  it("refuses a link to a secret and another session's artifact", async () => {
    const dir = repo();
    const s = session(dir, false);
    const secretDir = fs.mkdtempSync(path.join(os.tmpdir(), "aos-sec-"));
    fs.writeFileSync(path.join(secretDir, ".env"), "TOKEN=1\n");
    fs.symlinkSync(path.join(secretDir, ".env"), path.join(dir, "notes.md"));
    s.write("notes.md");
    const notes = byName(await list(s.id), "notes.md");
    expect((await one(s.id, notes.id)).status).toBe(403);

    const other = session(repo(), false);
    expect((await one(other.id, notes.id)).status).toBe(404);
    expect((await one(s.id, "0123456789abcdef")).status).toBe(404);
    expect((await one(randomUUID(), notes.id)).status).toBe(404);
  });

  it("keeps uncommitted files when the worktree goes, and says where the rest are", async () => {
    const dir = repo();
    const s = session(dir);
    fs.mkdirSync(path.join(dir, ".agentos"));
    fs.writeFileSync(path.join(dir, ".agentos/plan.md"), "# Kept plan\n");
    s.write(".agentos/plan.md");
    s.write("src/a.ts", "Edit");
    s.write("scratch.txt");
    fs.writeFileSync(path.join(dir, "scratch.txt"), "scratch\n");
    await list(s.id);

    await keepSessionFiles(s.id);
    fs.rmSync(dir, { recursive: true, force: true });

    const all = await list(s.id);
    expect(byName(all, "Plan").state).toBe("kept");
    expect(byName(all, "scratch.txt").state).toBe("kept");
    expect(byName(all, "a.ts").state).toBe("in-pr");
    const plan = await one(s.id, byName(all, "Plan").id);
    expect(await plan.text()).toBe("# Kept plan\n");
    expect((await one(s.id, byName(all, "a.ts").id)).status).toBe(404);
  });

  it("keeps nothing for a session without a worktree, and never throws", async () => {
    await expect(keepSessionFiles(randomUUID())).resolves.toBeUndefined();
  });
});
