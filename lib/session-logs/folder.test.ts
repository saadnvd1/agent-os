import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { createProject } from "../projects";
import {
  logFolder,
  setLogFolder,
  targetDir,
  writeLogFile,
  type FileTarget,
} from "./folder";
import { tempDir } from "@/lib/test-temp";

const tmp = () => tempDir("log-folder-");

function project() {
  const repo = tmp();
  fs.mkdirSync(path.join(repo, "docs"));
  return {
    repo,
    p: createProject({
      name: `p-${path.basename(repo)}`,
      workingDirectory: repo,
    }),
  };
}

const target = (projectId: string | null): FileTarget => ({
  workspace: "Work Space",
  project: "My API",
  projectId,
  name: "Add login!",
  id: "1234567890abcdef",
  day: "2026-10-12",
});

describe("session log folder setting", () => {
  it("refuses a folder inside the project's repository", () => {
    const { repo, p } = project();
    expect(() => setLogFolder(p.id, repo)).toThrow(
      /inside the project's repository/
    );
    expect(() => setLogFolder(p.id, path.join(repo, "docs", "logs"))).toThrow(
      /Repositories can be public/
    );
    expect(logFolder(p.id)).toBeNull();
  });

  it("refuses a symlink that leads into the repository", () => {
    const { repo, p } = project();
    const link = path.join(tmp(), "link");
    fs.symlinkSync(path.join(repo, "docs"), link);
    expect(() => setLogFolder(p.id, path.join(link, "x"))).toThrow(/inside/);
  });

  it("refuses a repository added to the project too, and a ~ path into one", () => {
    const { p } = project();
    const other = tmp();
    const home = vi.spyOn(os, "homedir").mockReturnValue(other);
    // The project's primary repository is its working directory; one under
    // a mocked home is caught through ~ expansion.
    const p2 = createProject({
      name: `q-${path.basename(other)}`,
      workingDirectory: "~",
    });
    expect(() => setLogFolder(p2.id, "~/logs")).toThrow(/inside/);
    home.mockRestore();
    expect(logFolder(p.id)).toBeNull();
  });

  it("refuses a relative path", () => {
    const { p } = project();
    expect(() => setLogFolder(p.id, "logs/here")).toThrow(/absolute/);
  });

  it("accepts a folder outside the repository, and clears with an empty one", () => {
    const { p } = project();
    const out = tmp();
    setLogFolder(p.id, out);
    expect(logFolder(p.id)).toBe(out);
    setLogFolder(p.id, "  ");
    expect(logFolder(p.id)).toBeNull();
  });

  it("expands ~ in a saved folder", () => {
    const { p } = project();
    const home = tmp();
    const spy = vi.spyOn(os, "homedir").mockReturnValue(home);
    setLogFolder(p.id, "~/notes/logs");
    expect(logFolder(p.id)).toBe("~/notes/logs");
    expect(targetDir(target(p.id))).toBe(path.join(home, "notes", "logs"));
    spy.mockRestore();
  });
});

describe("where a log file goes", () => {
  beforeEach(() => {
    // The test setup moves the default; these assert the real one.
    vi.stubEnv("AGENTOS_SESSION_LOGS_DIR", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("defaults to the data folder by workspace and project", () => {
    const home = tmp();
    const spy = vi.spyOn(os, "homedir").mockReturnValue(home);
    const { p } = project();
    const file = writeLogFile(target(p.id), "# log\n");
    expect(file).toBe(
      path.join(
        home,
        ".agent-os",
        "session-logs",
        "work-space",
        "my-api",
        "2026-10-12-add-login.md"
      )
    );
    expect(fs.readFileSync(file, "utf8")).toBe("# log\n");
    spy.mockRestore();
  });

  it("uses the project's folder", () => {
    const { p } = project();
    const out = tmp();
    setLogFolder(p.id, out);
    expect(path.dirname(writeLogFile(target(p.id), "x"))).toBe(out);
  });

  it("falls back to the default when a saved folder is inside the repo", () => {
    const home = tmp();
    const spy = vi.spyOn(os, "homedir").mockReturnValue(home);
    const { repo, p } = project();
    // A setting saved before the project moved, not one the setter allows.
    db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)`).run(
      `session-logs.folder.${p.id}`,
      path.join(repo, "logs")
    );
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(targetDir(target(p.id))).toBe(
      path.join(home, ".agent-os", "session-logs", "work-space", "my-api")
    );
    expect(err).toHaveBeenCalled();
    err.mockRestore();
    spy.mockRestore();
  });

  it("never overwrites a file, and keeps both when two tasks collide", () => {
    const { p } = project();
    setLogFolder(p.id, tmp());
    const a = writeLogFile(target(p.id), "first");
    const b = writeLogFile(
      { ...target(p.id), id: "ffffffffeeeeeeee" },
      "second"
    );
    expect(a).not.toBe(b);
    expect(fs.readFileSync(a, "utf8")).toBe("first");
    expect(b).toMatch(/-ffffffff\.md$/);
  });
});
