// Each orchestrator tool's arguments, once: the MCP server shows these to
// the model, and the server validates every call against them.

import { z } from "zod";
import { BRANCH_NAME } from "../git";
import { RAISED_KINDS } from "./asks";
import { MAX_RULE_CHARS } from "./rules";
import { PROJECT_NAME } from "../project-add/name";
import { TASK_ROLES, type ModelRole } from "../models/roles";

const ref = (what: string) => z.string().trim().min(1).max(300).describe(what);
const session = ref("Session name, project/name, or id from sessions");
const task = ref("Task name, project/name, id, or its PR (#12)");
const project = ref("A project of this workspace, by name");
const stackId = ref("Stack id (or its name) from stack or sessions");
const view = z
  .enum(["chat", "terminal"])
  .optional()
  .describe(
    "How its agent runs: chat (the default), or terminal only when the job needs a TUI (an interactive program, a full-screen tool)"
  );

const modelRef = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9_-]*\/[\w.:@/-]+$/i, 'not "provider/model"');
const modelOverride = z
  .union([
    modelRef,
    // Named optional keys, not z.partialRecord: its "propertyNames" makes
    // Claude Code drop every tool on this server, not just this one.
    z
      .object(
        Object.fromEntries(
          TASK_ROLES.map((role) => [role, modelRef.optional()])
        ) as Record<ModelRole, z.ZodOptional<typeof modelRef>>
      )
      .strict(),
  ])
  .optional()
  .describe(
    "Its own model, as \"provider/model\" (anthropic/claude-sonnet-5-5, deepseek/deepseek-v4-pro) for all its roles, or a map of role (plan, implement, review, scope) to one. Default: the workspace's and Settings' role models; another provider only when asked"
  );

export const TOOL_SHAPES = {
  sessions: {},
  read: {
    session,
    lines: z
      .number()
      .int()
      .min(1)
      .max(400)
      .optional()
      .describe("How many lines from the end (default 60)"),
  },
  cards: {
    board: ref("One board, by board or project name").optional(),
  },
  logs: {
    project: project.optional(),
    task: ref(
      "One merged task's log, by task name, id (or its first characters) or PR (#12); without it, the latest headers"
    ).optional(),
    n: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe("How many headers, newest first (default 10)"),
  },
  send: {
    session,
    message: z.string().trim().min(1).max(8000),
    scope_change: z
      .boolean()
      .optional()
      .describe(
        "The message changes the task's scope (Saad added, dropped or changed what it must do): it's recorded on the task's brief, and its review judges the PR against the brief as amended. Only for a change Saad made, never one the task asked for itself"
      ),
  },
  orchestrators: {},
  message_orchestrator: {
    workspace: ref("Another workspace's name, from orchestrators"),
    message: z.string().trim().min(1).max(8000),
  },
  start_task: {
    project,
    prompt: z
      .string()
      .trim()
      .min(1)
      .max(20000)
      .describe("What to build, as a full brief"),
    base: z
      .string()
      .regex(BRANCH_NAME, "not a branch name")
      .optional()
      .describe("Branch to cut from (default: the project's default branch)"),
    name: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .optional()
      .describe("A short name, 2-6 words (default: one made from the prompt)"),
    view,
    after: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe(
        'Queue it until this task finishes (id or name), or "any" for whichever running task finishes first'
      ),
    model: modelOverride,
    plan: z
      .boolean()
      .describe(
        "Your decision for this job: true to plan first on the planning model, then implement on the implementation model; false to skip the plan and put the steps in the prompt yourself"
      ),
    plan_only: z
      .boolean()
      .optional()
      .describe(
        "true: write the plan on the planning model, then stop and wait; implementation starts only when you approve_plan it (drop rejects it). Implies plan true"
      ),
    plan_reason: z
      .string()
      .trim()
      .min(3)
      .max(200)
      .describe(
        'Why, in a few words Saad reads on the task card: "touches 6 files across gates and UI", "one-line default change"'
      ),
  },
  set_task_model: {
    task,
    model: modelOverride.unwrap(),
    message: z
      .string()
      .trim()
      .min(1)
      .max(8000)
      .optional()
      .describe(
        "What it's told on resuming (default: carry on where it left off)"
      ),
  },
  start_session: {
    project,
    prompt: z.string().trim().min(1).max(20000),
    name: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .optional()
      .describe("A short name, 2-6 words (default: one made from the prompt)"),
    view,
    model: modelRef
      .optional()
      .describe(
        'One model for the session, "provider/model"; default: the implementation model. Opus only when the work needs deep reasoning'
      ),
  },
  quick_change: {
    project,
    name: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .describe("A short name for the change, 2-6 words"),
  },
  quick_pr: {
    change: ref("Your quick change, by name or id"),
    title: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe("The PR's title, also its commit message"),
    body: z
      .string()
      .trim()
      .min(1)
      .max(20000)
      .describe(
        "What changed and why; the review judges the change against it"
      ),
  },
  stack: {
    target: ref("Board or project name"),
    plan_only: z.boolean().optional(),
  },
  stack_status: { id: stackId },
  land: { id: stackId },
  approve_plan: {
    task,
    message: z
      .string()
      .trim()
      .min(1)
      .max(8000)
      .optional()
      .describe(
        "Amends the plan: recorded on the task's brief as a scope change, so its review judges the PR against it. Only for a change Saad made"
      ),
  },
  plan_pieces: {
    task,
    merge: z
      .array(z.number().int().min(2).max(6))
      .optional()
      .describe("Waiting pieces to fold into the piece before them"),
    drop: z
      .array(z.number().int().min(2).max(6))
      .optional()
      .describe("Waiting pieces to leave out; pieces after them are held"),
  },
  drop: { task, reason: z.string().trim().min(1).max(2000) },
  move: {
    task,
    machine: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe(
        'A linked machine\'s name (see Machines), or "here" to bring the task back'
      ),
  },
  stop: { session },
  done: { session },
  archive: { session },
  add_project: {
    path: z
      .string()
      .trim()
      .min(1)
      .max(1000)
      .describe("The git repository's absolute path on this machine"),
    name: z
      .string()
      .trim()
      .regex(PROJECT_NAME, "use letters, numbers, dots, dashes or underscores")
      .optional()
      .describe("A new project's name (default: the folder's)"),
  },
  note: { text: z.string().trim().min(1).max(2000) },
  question: {
    text: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .describe("The question as you asked it in chat, one or two sentences"),
    task: ref("The task it is about, when it names one").optional(),
  },
  resolve_question: {
    id: z.number().int().positive().describe("The question's id"),
  },
  rule_add: {
    text: z
      .string()
      .trim()
      .min(1)
      .max(MAX_RULE_CHARS)
      .describe("The rule, one sentence"),
  },
  rule_remove: { id: z.number().int().positive().describe("The rule's id") },
  remind_me: {
    at: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .describe('When: "tomorrow 10am", "in 2h" or 2026-10-12T10:00 (Central)'),
    prompt: z
      .string()
      .trim()
      .min(1)
      .max(2000)
      .describe("What to remind yourself of, in words you'll understand later"),
    name: z.string().trim().min(1).max(80).optional(),
  },
  recipes: {
    name: ref("A recipe's name or id; leave out to list them all").optional(),
  },
  run_recipe: {
    name: ref("The recipe's name or id, from recipes"),
    note: z
      .string()
      .trim()
      .min(1)
      .max(1000)
      .optional()
      .describe(
        'A one-off line for this run only ("Includes #87"); the brief stays as saved'
      ),
  },
  recipe_save: {
    name: z.string().trim().min(1).max(80).describe("2-6 words, no quotes"),
    project,
    kind: z
      .enum(["task", "session"])
      .describe(
        "task ends in a PR through the gates; session changes no code and has no PR"
      ),
    brief: z
      .string()
      .trim()
      .min(1)
      .max(4000)
      .describe(
        "Short: what to run and how to judge it. The steps belong in a script in the repo"
      ),
    model: modelRef.optional(),
    view,
  },
  recipe_update: {
    name: ref("The recipe's name or id"),
    brief: z.string().trim().min(1).max(4000).optional(),
    new_name: z.string().trim().min(1).max(80).optional(),
    model: modelRef.optional(),
    view,
    auto_done: z.boolean().optional(),
    max_minutes: z.number().int().min(1).max(1440).optional(),
  },
  reminders: {},
  cancel_reminder: { id: ref("The reminder's id, from reminders") },
  review: {
    target: ref("The task, or its PR (#12 or URL)"),
    fresh: z
      .boolean()
      .optional()
      .describe("Run it again even if this commit has a verdict"),
  },
  sign_off: { task },
  arm: { task },
  disarm: { task },
  ask_saad: {
    title: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe("What Saad decides, as a short question"),
    detail: z
      .string()
      .trim()
      .min(1)
      .max(2000)
      .describe(
        "The one-line why, then anything he needs: the exact command or change"
      ),
    link: z
      .string()
      .trim()
      .max(500)
      .optional()
      .describe("A PR, card or page to look at"),
    kind: z
      .enum(RAISED_KINDS)
      .describe(
        "decision (a call that's his), or the hard line it crosses: public (public or outbound), money, irreversible, credentials, product (what gets built)"
      ),
    task: ref(
      "Only when asking whether to merge a PR: the task, or its PR (#12 or URL). Needs sha"
    ).optional(),
    sha: z
      .string()
      .trim()
      .regex(/^[0-9a-f]{7,40}$/i, "not a commit sha")
      .optional()
      .describe(
        "With task: the PR's head commit you're asking to merge. His approval lets sign_off merge it once, at that commit only"
      ),
  },
} satisfies Record<string, z.ZodRawShape>;

export type ToolName = keyof typeof TOOL_SHAPES;
export const TOOLS = Object.keys(TOOL_SHAPES) as ToolName[];
export type ToolArgsOf<T extends ToolName> = z.infer<
  z.ZodObject<(typeof TOOL_SHAPES)[T]>
>;

export const isToolName = (t: unknown): t is ToolName =>
  typeof t === "string" && Object.hasOwn(TOOL_SHAPES, t);

// The call's arguments, checked; throws a plain message on anything else.
export function parseArgs<T extends ToolName>(
  tool: T,
  args: unknown
): ToolArgsOf<T> {
  const parsed = z
    .object(TOOL_SHAPES[tool])
    .strict()
    .safeParse(args ?? {});
  if (!parsed.success)
    throw new Error(
      `Bad arguments for ${tool}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "args"} ${i.message}`).join("; ")}`
    );
  return parsed.data as unknown as ToolArgsOf<T>;
}
