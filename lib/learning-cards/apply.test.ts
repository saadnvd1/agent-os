import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { setExperiment } from "../experiments";
import { listRules } from "../orchestrator/rules";
import { clearCards, seedSession } from "./__fixtures__/db";

const quickPR = vi.fn(async () => ({ id: "q", text: "" }));
let quickDir = "";
const startQuickChange = vi.fn(async () => ({
  id: "quick-1",
  worktreePath: quickDir,
  text: "",
}));
vi.mock("../orchestrator/quick", () => ({
  startQuickChange: (...a: unknown[]) => startQuickChange(...(a as [])),
  quickPR: (...a: unknown[]) => quickPR(...(a as [])),
}));
const createTask = vi.fn(async () => ({ id: "task-1" }));
const hostExec = vi.fn(async () => ({ stdout: "1\n", stderr: "" }));
vi.mock("../hosts", async (orig) => ({
  ...(await orig<typeof import("../hosts")>()),
  hostExec: (...a: unknown[]) => hostExec(...(a as [])),
}));
const dropTask = vi.fn(async () => {});
vi.mock("../tasks", () => ({
  createTask: (...a: unknown[]) => createTask(...(a as [])),
  dropTask: (...a: unknown[]) => dropTask(...(a as [])),
}));

const { applyCard, dismissCard, acceptRecipeCardFor, withLesson, CardRefused } =
  await import("./apply");
const { insertCard, getCard } = await import("./store");
const { cardsFor } = await import("./index");
const { getRecipe } = await import("../recipes/store");
const { createRecipe } = await import("../recipes/store");

const counts = (event: string) =>
  (
    db
      .prepare(`SELECT COUNT(*) AS n FROM experiment_usage WHERE event = ?`)
      .get(event) as { n: number }
  ).n;

function lessonCard(
  s: ReturnType<typeof seedSession>,
  payload: Record<string, unknown>
) {
  return insertCard({
    sessionId: s.id,
    workspaceId: s.ws.id,
    kind: "lesson",
    destination: payload.destination as "rule",
    payload: {
      lesson: "Run tests first",
      pairs: 1,
      projectId: s.project.id,
      projectName: "P",
      ...payload,
    } as never,
  })!;
}

const repos: string[] = [];
afterEach(() => {
  for (const d of repos.splice(0))
    fs.rmSync(d, { recursive: true, force: true });
});

beforeEach(() => {
  hostExec.mockReset();
  hostExec.mockResolvedValue({ stdout: "1\n", stderr: "" });
  clearCards();
  setExperiment("learning-cards", true);
  quickPR.mockClear();
  startQuickChange.mockClear();
  createTask.mockClear();
  dropTask.mockClear();
  quickDir = fs.mkdtempSync(path.join(os.tmpdir(), "lc-quick-"));
});

describe("withLesson", () => {
  it("makes the heading, appends under it, and skips a repeat", () => {
    expect(withLesson("", "Run tests")).toBe("## Lessons\n\n- Run tests\n");
    expect(withLesson("# Repo\n\nText\n", "A")).toBe(
      "# Repo\n\nText\n\n## Lessons\n\n- A\n"
    );
    const two = withLesson("# R\n\n## Lessons\n\n- A\n\n## Other\n\nx\n", "B");
    expect(two).toBe("# R\n\n## Lessons\n\n- A\n- B\n\n## Other\n\nx\n");
    expect(withLesson(two, "B")).toBe(two);
  });
});

describe("applyCard", () => {
  it("saves a recipe from a recipe card, with the edited brief and its source session", async () => {
    const s = seedSession();
    const card = insertCard({
      sessionId: s.id,
      workspaceId: s.ws.id,
      kind: "recipe",
      payload: { signals: ["facts"], brief: "Drafted brief", summary: "s" },
    })!;
    const done = await applyCard(card.id, { brief: "Edited brief" });
    expect(done.status).toBe("accepted");
    const recipe = getRecipe(done.applied_ref!)!;
    expect(recipe).toMatchObject({
      brief: "Edited brief",
      source_session_id: s.id,
      workspace_id: s.ws.id,
    });
    expect(counts("accepted")).toBe(1);
  });

  it("appends a lesson to the recipe's brief and keeps a revision", async () => {
    const s = seedSession();
    const recipe = createRecipe({
      workspaceId: s.ws.id,
      projectId: s.project.id,
      name: "Build",
      kind: "session",
      brief: "Build it",
    });
    const card = lessonCard(s, {
      destination: "recipe",
      recipeId: recipe.id,
      recipeName: "Build",
    });
    await applyCard(card.id);
    expect(getRecipe(recipe.id)!.brief).toBe(
      "Build it\n\nLesson: Run tests first"
    );
    expect(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM recipe_revisions WHERE recipe_id = ?`
          )
          .get(recipe.id) as { n: number }
      ).n
    ).toBe(2);
  });

  it("writes CLAUDE.md in a quick change and opens its PR when the workspace has an orchestrator", async () => {
    const s = seedSession({ orchestrator: true });
    const card = lessonCard(s, { destination: "claude_md" });
    const done = await applyCard(card.id, { lesson: "Run the linter first" });
    expect(fs.readFileSync(path.join(quickDir, "CLAUDE.md"), "utf8")).toBe(
      "## Lessons\n\n- Run the linter first\n"
    );
    expect(quickPR).toHaveBeenCalledWith(
      s.ws.id,
      "quick-1",
      "docs: add a lesson to CLAUDE.md",
      expect.stringContaining("Run the linter first")
    );
    expect(done.applied_ref).toBe("quick-1");
    expect(createTask).not.toHaveBeenCalled();
  });

  function repoFor(s: ReturnType<typeof seedSession>, ignored: boolean) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lc-repo-"));
    repos.push(dir);
    const env = { ...process.env };
    delete env.GIT_DIR;
    delete env.GIT_INDEX_FILE;
    const g = (...a: string[]) =>
      execFileSync("git", ["-C", dir, ...a], { env });
    g("init", "-q");
    fs.writeFileSync(
      path.join(dir, ".gitignore"),
      ignored ? "CLAUDE.md\n" : ""
    );
    if (!ignored) fs.writeFileSync(path.join(dir, "CLAUDE.md"), "# Repo\n");
    db.prepare(`UPDATE projects SET working_directory = ? WHERE id = ?`).run(
      dir,
      s.project.id
    );
    return dir;
  }

  it("appends to an ignored CLAUDE.md in the checkout, with no quick change or task", async () => {
    const s = seedSession({ orchestrator: true });
    const dir = repoFor(s, true);
    fs.writeFileSync(path.join(dir, "CLAUDE.md"), "# Notes\n\nkeep me\n");
    const done = await applyCard(
      lessonCard(s, { destination: "claude_md" }).id
    );
    expect(fs.readFileSync(path.join(dir, "CLAUDE.md"), "utf8")).toBe(
      "# Notes\n\nkeep me\n\n## Lessons\n\n- Run tests first\n"
    );
    expect(done.status).toBe("accepted");
    expect(done.applied_ref).toBe("CLAUDE.md");
    expect(startQuickChange).not.toHaveBeenCalled();
    expect(createTask).not.toHaveBeenCalled();
  });

  it("creates an ignored CLAUDE.md when it is missing", async () => {
    const s = seedSession({ orchestrator: true });
    const dir = repoFor(s, true);
    await applyCard(lessonCard(s, { destination: "claude_md" }).id);
    expect(fs.readFileSync(path.join(dir, "CLAUDE.md"), "utf8")).toBe(
      "## Lessons\n\n- Run tests first\n"
    );
  });

  it.each([
    ["ignored", async () => ({ stdout: "0\n", stderr: "" })],
    ["uncheckable", async () => ({ stdout: "128\n", stderr: "" })],
    [
      "unreachable",
      async () => {
        throw new Error("ssh down");
      },
    ],
  ])("refuses a remote project whose CLAUDE.md is %s", async (_n, reply) => {
    const s = seedSession({ orchestrator: true });
    db.prepare(`UPDATE projects SET host_id = 'remote-1' WHERE id = ?`).run(
      s.project.id
    );
    hostExec.mockImplementationOnce(reply);
    const card = lessonCard(s, { destination: "claude_md" });
    await expect(applyCard(card.id)).rejects.toThrow(CardRefused);
    expect(getCard(card.id)?.status).toBe("pending");
    expect(startQuickChange).not.toHaveBeenCalled();
    expect(createTask).not.toHaveBeenCalled();
  });

  it("still starts a task for a remote project whose CLAUDE.md is tracked", async () => {
    const s = seedSession();
    db.prepare(`UPDATE projects SET host_id = 'remote-1' WHERE id = ?`).run(
      s.project.id
    );
    await applyCard(lessonCard(s, { destination: "claude_md" }).id);
    expect(createTask).toHaveBeenCalled();
  });

  it("keeps the quick change and PR for a tracked CLAUDE.md", async () => {
    const s = seedSession({ orchestrator: true });
    repoFor(s, false);
    const done = await applyCard(
      lessonCard(s, { destination: "claude_md" }).id
    );
    expect(done.applied_ref).toBe("quick-1");
    expect(quickPR).toHaveBeenCalled();
  });

  it("drops the quick change when its PR fails, and releases the card", async () => {
    const s = seedSession({ orchestrator: true });
    const card = lessonCard(s, { destination: "claude_md" });
    quickPR.mockRejectedValueOnce(new Error("nothing to commit"));
    await expect(applyCard(card.id)).rejects.toThrow("nothing to commit");
    expect(dropTask).toHaveBeenCalledWith("quick-1");
    expect(getCard(card.id)?.status).toBe("pending");
  });

  it("starts a small task for CLAUDE.md when there is no orchestrator", async () => {
    const s = seedSession();
    await applyCard(lessonCard(s, { destination: "claude_md" }).id);
    expect(startQuickChange).not.toHaveBeenCalled();
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: s.project.id,
        startedBy: null,
        prompt: expect.stringContaining("Run tests first"),
      })
    );
  });

  it("starts the card's task for a check", async () => {
    const s = seedSession();
    const card = lessonCard(s, {
      destination: "check",
      taskPrompt: "Add a lint rule",
    });
    const done = await applyCard(card.id, {
      taskPrompt: "Add a stricter lint rule",
    });
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Add a stricter lint rule",
        projectId: s.project.id,
      })
    );
    expect(done.applied_ref).toBe("task-1");
  });

  it("adds a workspace rule, as the person's", async () => {
    const s = seedSession();
    const done = await applyCard(lessonCard(s, { destination: "rule" }).id);
    expect(listRules(s.ws.id)).toEqual([
      expect.objectContaining({ text: "Run tests first", added_by: "saad" }),
    ]);
    expect(done.applied_ref).toBe(String(listRules(s.ws.id)[0].id));
  });

  it("puts the card back when the destination fails", async () => {
    const s = seedSession();
    const card = lessonCard(s, { destination: "recipe", recipeId: "gone" });
    await expect(applyCard(card.id)).rejects.toThrow(/gone/);
    expect(getCard(card.id)!.status).toBe("pending");
  });

  it("refuses when off, when already decided, and a second tap", async () => {
    const s = seedSession();
    const card = lessonCard(s, { destination: "rule" });
    setExperiment("learning-cards", false);
    await expect(applyCard(card.id)).rejects.toBeInstanceOf(CardRefused);
    setExperiment("learning-cards", true);
    await applyCard(card.id);
    await expect(applyCard(card.id)).rejects.toThrow(/Already decided/);
    expect(() => dismissCard(card.id)).toThrow(/Already decided/);
    expect(listRules(s.ws.id)).toHaveLength(1);
  });
});

describe("dismissCard and the recipe form", () => {
  it("records a dismissal and applies nothing", () => {
    const s = seedSession();
    const card = lessonCard(s, { destination: "rule" });
    expect(dismissCard(card.id).status).toBe("dismissed");
    expect(counts("dismissed")).toBe(1);
    expect(listRules(s.ws.id)).toEqual([]);
  });

  it("the form's save takes the session's recipe card", () => {
    const s = seedSession();
    const card = insertCard({
      sessionId: s.id,
      workspaceId: s.ws.id,
      kind: "recipe",
      payload: { signals: [], brief: "b", summary: "" },
    })!;
    acceptRecipeCardFor(s.id, "recipe-9");
    expect(getCard(card.id)).toMatchObject({
      status: "accepted",
      applied_ref: "recipe-9",
    });
    expect(counts("accepted")).toBe(1);
  });
});

describe("cardsFor", () => {
  it("is empty and counts nothing while off", () => {
    const s = seedSession();
    lessonCard(s, { destination: "rule" });
    setExperiment("learning-cards", false);
    expect(cardsFor(s.id)).toEqual([]);
    expect(counts("shown")).toBe(0);
  });

  it("lists pending cards and counts each as shown once", () => {
    const s = seedSession();
    lessonCard(s, { destination: "rule" });
    expect(cardsFor(s.id)).toHaveLength(1);
    expect(cardsFor(s.id)).toHaveLength(1);
    expect(counts("shown")).toBe(1);
  });
});
