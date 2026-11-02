import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "@/lib/test-temp";

// discard_generated in a real clone: a build-modified generated file must not
// block a pull that deletes it upstream, and a real local edit still does.
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd,
    encoding: "utf-8",
  });

function setup() {
  const root = tempDir("aos-generated-");
  const origin = path.join(root, "origin");
  const seed = path.join(root, "seed");
  const work = path.join(root, "work");
  git(root, "init", "-q", "-b", "main", seed);
  fs.mkdirSync(path.join(seed, "scripts/lib"), { recursive: true });
  for (const f of ["generated-files.txt", "lib/generated.sh"])
    fs.copyFileSync(
      path.join(import.meta.dirname, f),
      path.join(seed, "scripts", f)
    );
  fs.writeFileSync(path.join(seed, "next-env.d.ts"), "dev\n");
  fs.writeFileSync(path.join(seed, "app.ts"), "a\n");
  git(seed, "add", ".");
  git(seed, "commit", "-qm", "first");
  git(root, "clone", "-q", "--bare", seed, origin);
  git(root, "clone", "-q", origin, work);
  // Upstream stops tracking the generated file.
  git(seed, "remote", "add", "origin", origin);
  git(seed, "rm", "-q", "--cached", "next-env.d.ts");
  git(seed, "commit", "-qm", "untrack");
  git(seed, "push", "-q", "origin", "main");
  return work;
}

const discard = (cwd: string) =>
  execFileSync(
    "bash",
    ["-c", "source scripts/lib/generated.sh && discard_generated"],
    { cwd, encoding: "utf-8" }
  );

describe("discard_generated", () => {
  it("restores a build-modified generated file so the pull goes through", () => {
    const work = setup();
    fs.writeFileSync(path.join(work, "next-env.d.ts"), "build\n");
    discard(work);
    expect(git(work, "status", "--porcelain", "--untracked-files=no")).toBe("");
    git(work, "pull", "-q", "--ff-only");
    expect(git(work, "ls-files", "next-env.d.ts")).toBe("");
  });

  it("leaves real local changes in place", () => {
    const work = setup();
    fs.writeFileSync(path.join(work, "next-env.d.ts"), "build\n");
    fs.writeFileSync(path.join(work, "app.ts"), "edited\n");
    discard(work);
    expect(git(work, "status", "--porcelain", "--untracked-files=no")).toBe(
      " M app.ts\n"
    );
  });

  it("leaves an untracked generated file alone", () => {
    const work = setup();
    git(work, "pull", "-q", "--ff-only");
    fs.writeFileSync(path.join(work, "next-env.d.ts"), "build\n");
    discard(work);
    expect(fs.readFileSync(path.join(work, "next-env.d.ts"), "utf-8")).toBe(
      "build\n"
    );
  });
});
