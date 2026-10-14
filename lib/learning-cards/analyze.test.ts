import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { setExperiment } from "../experiments";
import type { ClaudeRun } from "../orchestrator/claude-cli";
import { bash, releaseToTesters } from "./__fixtures__/sessions";
import { clearCards, seedSession } from "./__fixtures__/db";

vi.mock("../git", async (orig) => ({
  ...(await orig<typeof import("../git")>()),
  isGitRepo: async () => false,
}));

const { analyzeSession, checkLesson } = await import("./analyze");
const { listCards } = await import("./store");

const usage = {
  model: "claude-haiku-4-5-20251001",
  inputTokens: 800,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  outputTokens: 60,
  costUsd: 0.001,
  durationMs: 900,
};

const ANSWER = {
  recipe: {
    repeatable: true,
    brief: "Send the latest build to testers",
    summary: "Beta send",
  },
  lesson: {
    reusable: true,
    lesson: "Use npm run build, not npm run biuld",
    destination: "rule" as string,
    taskPrompt: "",
  },
};

function fake(answers: Partial<typeof ANSWER> | Error = ANSWER) {
  return vi.fn(async (r: ClaudeRun) => {
    r.onUsage?.(usage);
    if (answers instanceof Error) throw answers;
    const a = { ...ANSWER, ...answers };
    return "repeatable" in (r.schema as { properties: object }).properties
      ? a.recipe
      : a.lesson;
  });
}

const rows = (event: string) =>
  db.prepare(`SELECT * FROM experiment_usage WHERE event = ?`).all(event);

const release = () => {
  const s = releaseToTesters();
  return seedSession({
    steps: [
      ...s.steps,
      bash("npm run biuld", { ok: false, output: "no script" }),
      bash("npm run build"),
    ],
    final: s.final,
    orchestrator: true,
  });
};

beforeEach(() => {
  clearCards();
  setExperiment("learning-cards", true);
});

describe("analyzeSession", () => {
  it("does nothing at all while the experiment is off", async () => {
    setExperiment("learning-cards", false);
    const { id } = release();
    const runner = fake();
    await analyzeSession(id, "done", runner);
    expect(runner).not.toHaveBeenCalled();
    expect(listCards(id)).toEqual([]);
    expect(
      db.prepare(`SELECT COUNT(*) AS n FROM experiment_usage`).get()
    ).toEqual({ n: 0 });
  });

  it("makes both cards, meters each call, and leaves one note for the orchestrator", async () => {
    const { id, ws } = release();
    const runner = fake();
    await analyzeSession(id, "done", runner);
    expect(runner).toHaveBeenCalledTimes(2);
    expect(listCards(id).map((c) => c.kind)).toEqual(["recipe", "lesson"]);
    expect(rows("script")).toHaveLength(1);
    expect(rows("model")).toHaveLength(2);
    const notes = db
      .prepare(`SELECT text FROM orchestrator_notes WHERE workspace_id = ?`)
      .all(ws.id) as { text: string }[];
    expect(notes).toHaveLength(1);
    expect(notes[0].text).toContain("Learning card on Beta build");
  });

  it("sends the helper the brief and report, never the transcript", async () => {
    const { id } = release();
    const runner = fake();
    await analyzeSession(id, "done", runner);
    const prompt = runner.mock.calls[0][0].prompt;
    expect(prompt).toContain("beta testers");
    expect(prompt).toContain("Build 57");
    expect(prompt).not.toContain("asc builds list");
    expect(prompt.length).toBeLessThan(4000);
  });

  it("makes no card when the model says not repeatable or not reusable", async () => {
    const { id } = release();
    await analyzeSession(
      id,
      "done",
      fake({
        recipe: { repeatable: false, brief: "x", summary: "" },
        lesson: {
          reusable: false,
          lesson: "",
          destination: "rule",
          taskPrompt: "",
        },
      })
    );
    expect(listCards(id)).toEqual([]);
    expect(rows("script")).toHaveLength(1);
  });

  it("calls no model without a signal or a pair", async () => {
    const { id } = seedSession({
      prompt: "Fix a typo in the readme",
      final: "Fixed.",
    });
    const runner = fake();
    await analyzeSession(id, "done", runner);
    expect(runner).not.toHaveBeenCalled();
    expect(rows("script")).toHaveLength(1);
  });

  it("a failing model call leaves that card out and still tries the other", async () => {
    const { id } = release();
    const runner = vi.fn(async (r: ClaudeRun) => {
      r.onUsage?.(usage);
      if ("repeatable" in (r.schema as { properties: object }).properties)
        throw new Error("offline");
      return ANSWER.lesson;
    });
    await analyzeSession(id, "done", runner);
    expect(listCards(id).map((c) => c.kind)).toEqual(["lesson"]);
    expect(rows("error")).toHaveLength(1);
  });

  it("works a session once", async () => {
    const { id } = release();
    const runner = fake();
    await analyzeSession(id, "done", runner);
    await analyzeSession(id, "merged", runner);
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("waits for a recipe run to settle before looking at its session", async () => {
    const { id, project, ws } = seedSession({
      steps: [bash("npm run biuld", { ok: false }), bash("npm run build")],
      final: "ok",
    });
    const { createRecipe } = await import("../recipes/store");
    const recipe = createRecipe({
      workspaceId: ws.id,
      projectId: project.id,
      name: "Build",
      kind: "session",
      brief: "Build it",
    });
    db.prepare(
      `INSERT INTO recipe_runs (recipe_id, seq, trigger, prompt, status, session_id) VALUES (?, 1, 'manual', 'p', 'running', ?)`
    ).run(recipe.id, id);
    const runner = fake();
    await analyzeSession(id, "done", runner);
    expect(runner).not.toHaveBeenCalled();
    expect(rows("script")).toHaveLength(0);
    db.prepare(
      `UPDATE recipe_runs SET status = 'succeeded' WHERE session_id = ?`
    ).run(id);
    await analyzeSession(id, "recipe-settled", runner);
    expect(rows("script")).toHaveLength(1);
  });
});

describe("checkLesson", () => {
  const where = {
    recipe: null,
    project: { id: "p", name: "P" },
    repo: true,
    workspaceId: "w",
  };
  const say = (destination: string, extra = {}) => ({
    reusable: true,
    lesson: "A lesson",
    destination,
    ...extra,
  });

  it("moves a recipe lesson to CLAUDE.md when no recipe ran", () => {
    expect(checkLesson(say("recipe"), where)?.destination).toBe("claude_md");
    expect(
      checkLesson(say("recipe"), { ...where, recipe: { id: "r", name: "R" } })
        ?.destination
    ).toBe("recipe");
  });

  it("makes no card for CLAUDE.md without a repo, or a check without a task", () => {
    expect(checkLesson(say("claude_md"), { ...where, repo: false })).toBeNull();
    expect(checkLesson(say("check"), where)).toBeNull();
    expect(
      checkLesson(say("check", { taskPrompt: "Add a lint rule" }), where)
    ).toMatchObject({
      destination: "check",
      taskPrompt: "Add a lint rule",
    });
  });

  it("clips a long lesson to one line and refuses unknown destinations", () => {
    expect(
      checkLesson(say("rule", { lesson: `a\n${"b".repeat(400)}` }), where)
        ?.lesson
    ).toHaveLength(200);
    expect(checkLesson(say("global"), where)).toBeNull();
    expect(
      checkLesson({ reusable: false, lesson: "x", destination: "rule" }, where)
    ).toBeNull();
  });
});
