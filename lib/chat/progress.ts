import type { ChatItem, ChatState, Compacting, ModelWait } from "./events";
import { formatTokens } from "./context";

type Tool = Extract<ChatItem, { kind: "tool" }>;

export type Phase = "planning" | "coding" | "testing" | "error";

// A wait on one model call this long gets a hint that it may be normal.
export const LONG_WAIT_MS = 2 * 60_000;
export const LONG_WAIT_HINT =
  "Still waiting on the model; large prompts on local models can take minutes";

const TEST_RE =
  /\b(test|tests|vitest|jest|pytest|mocha|playwright|tsc|typecheck|lint|eslint|build|check)\b|cargo (test|build|check)|go (test|build|vet)/;
const EDIT_TOOLS = new Set([
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
  "apply_patch",
]);
const VERBS: Record<string, string> = {
  Read: "Reading",
  Edit: "Editing",
  Write: "Writing",
  MultiEdit: "Editing",
  NotebookEdit: "Editing",
  Search: "Searching",
  Find: "Finding",
  Fetch: "Fetching",
  List: "Listing",
  Run: "Running",
};

const str = (v: unknown) => (typeof v === "string" ? v : "");
const input = (t: Tool) => (t.input ?? {}) as Record<string, unknown>;
const command = (t: Tool) => str(input(t).command);

// "ollama/qwen3-coder:30b" -> "qwen3-coder:30b"; nothing known -> "the model".
export function shortModel(label: string | undefined): string {
  let m = (label ?? "").trim().split("/").at(-1) ?? "";
  m = m.replace(/:latest$/, "").replace(/-\d{8}$/, "");
  if (!m || m.toLowerCase() === "default") return "the model";
  return m.length > 24 ? `${m.slice(0, 23)}…` : m;
}

const tail = (path: string) => path.split("/").slice(-3).join("/");
const clip = (s: string, n = 60) =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;

// A tool call in plain words: "Running npm test", "Editing src/a/b.ts".
export function stepLabel(t: Tool): string {
  const cmd = command(t);
  if (cmd) return `Running ${clip(cmd.replace(/\s+/g, " ").trim())}`;
  const path = str(input(t).file_path);
  if (path && EDIT_TOOLS.has(t.name)) {
    const verb = VERBS[t.name] ?? "Editing";
    return `${verb} ${tail(path)}`;
  }
  const [first, ...rest] = t.title.split(" ");
  return VERBS[first] && rest.length
    ? `${VERBS[first]} ${rest.join(" ")}`
    : t.title;
}

export function turnTools(items: ChatItem[]): Tool[] {
  let start = 0;
  items.forEach((i, n) => {
    if (i.kind === "user" && !i.midTurn) start = n + 1;
  });
  return items.slice(start).filter((i): i is Tool => i.kind === "tool");
}

const edited = (t: Tool) => EDIT_TOOLS.has(t.name) || !!t.diff;

// Planning, coding, testing or error, from the turn's tools: the current
// step (running, else the last one) decides error and testing; having
// edited anything in the turn makes the rest coding.
export function phaseOf(tools: Tool[]): Phase {
  const step = tools.findLast((t) => t.status === "running") ?? tools.at(-1);
  if (!step) return "planning";
  if (step.status === "error") return "error";
  if (TEST_RE.test(command(step))) return "testing";
  return tools.some(edited) ? "coding" : "planning";
}

export interface Activity {
  label: string;
  since?: number;
  compacting?: boolean;
  kind: "answer" | "compacting" | "tool" | "writing" | "waiting" | "retry";
  // The last measured prompt, when a driver reported one.
  tokens?: number;
  phase?: Phase;
  steps: number;
  // The last finished step, while no tool runs.
  lastStep?: string;
  turnSince?: number;
  hint?: string;
}

// What the turn is doing now and for how long, from its items.
export function currentActivity(
  items: ChatItem[],
  state: ChatState,
  compacting: Compacting | null = null,
  modelWait: ModelWait | null = null,
  model?: string,
  now: number = Date.now()
): Activity | null {
  if (state === "waiting")
    return { label: "Waiting for your answer", kind: "answer", steps: 0 };
  if (state !== "running") return null;
  if (compacting)
    return {
      label: `Compacting context…${compacting.before ? ` ${formatTokens(compacting.before)} tokens` : ""}`,
      since: compacting.since,
      compacting: true,
      kind: "compacting",
      steps: 0,
    };
  const lastUser = items.findLast((i) => i.kind === "user" && !i.midTurn);
  const tools = turnTools(items);
  const base = {
    steps: tools.length,
    turnSince: lastUser?.createdAt,
    phase: tools.length ? phaseOf(tools) : undefined,
  };
  const tool = tools.findLast((t) => t.status === "running");
  if (tool)
    return {
      ...base,
      label: stepLabel(tool),
      since: tool.createdAt,
      kind: "tool",
    };
  const last = items.at(-1);
  if (
    last &&
    (last.kind === "assistant" || last.kind === "reasoning") &&
    last.streaming
  )
    return {
      ...base,
      label: last.kind === "assistant" ? "Writing" : "Thinking",
      since: lastUser?.createdAt,
      kind: "writing",
    };
  const done = tools.findLast((t) => t.status !== "running");
  const since =
    modelWait?.since ?? done?.endedAt ?? done?.createdAt ?? lastUser?.createdAt;
  const retry = modelWait?.retry;
  return {
    ...base,
    label: retry
      ? `Retrying model request (attempt ${retry.attempt})`
      : `Waiting for ${shortModel(model)}`,
    since,
    kind: retry ? "retry" : "waiting",
    tokens: modelWait?.promptTokens,
    lastStep: done
      ? `${stepLabel(done)}${done.status === "error" ? " failed" : ""}`
      : undefined,
    hint:
      since !== undefined && now - since > LONG_WAIT_MS
        ? LONG_WAIT_HINT
        : undefined,
  };
}
