// Each orchestrator tool's arguments, once: the MCP server shows these to
// the model, and the server validates every call against them.

import { z } from "zod";
import { BRANCH_NAME } from "../git";
import { RAISED_KINDS } from "./asks";

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
  send: { session, message: z.string().trim().min(1).max(8000) },
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
  },
  stack: {
    target: ref("Board or project name"),
    plan_only: z.boolean().optional(),
  },
  stack_status: { id: stackId },
  land: { id: stackId },
  drop: { task, reason: z.string().trim().min(1).max(2000) },
  stop: { session },
  done: { session },
  note: { text: z.string().trim().min(1).max(2000) },
  review: {
    target: ref("The task, or its PR (#12 or URL)"),
    fresh: z
      .boolean()
      .optional()
      .describe("Run it again even if this commit has a verdict"),
  },
  sign_off: { task },
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
