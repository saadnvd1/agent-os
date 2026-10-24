import { redact } from "../../orchestrator/untrusted";
import type { TurnEndReason } from "../events";
import type { TurnSummary } from "./turn-items";
import { classifyProviderError } from "./transient-retry";

export interface TurnEnded {
  reason: TurnEndReason;
  notice: string;
}

// Said where a reply stopped short, so the fix is in the notice itself.
const SERVER_HINT =
  "If you run the model yourself, start its server with tool calling on (llama.cpp: --jinja; vLLM: --enable-auto-tool-choice --tool-call-parser; LM Studio: a model with tool use).";

const TAIL = 300;
const LOG_TAIL = 240;

const CLOSERS =
  /\b(let me know|i'?ll (wait|leave|stop|hold)|i will (wait|leave|stop)|if you'?d like|feel free|hope (this|that)|want me to)\b/i;
const ANNOUNCE =
  /\b(let me|let'?s|i'?ll|i will|i'?m going to|i am going to|going to|i need to|i should|now i|first,? i|next,? i|then i)\s+(\w+)/i;

// Whether the end of a reply says the model is about to do something.
export function announcesAction(text: string): boolean {
  const tail = text.trim().slice(-TAIL);
  if (!tail) return false;
  if (tail.endsWith("?")) return false;
  const last =
    tail
      .split(/(?<=[.!:])\s+|\n+/)
      .filter((s) => s.trim())
      .slice(-2)
      .join(" ") || tail;
  if (CLOSERS.test(last)) return false;
  return ANNOUNCE.test(last) || /:\s*$/.test(tail);
}

// Tool-call markup left in a reply: a call that was written, not made.
export function hasToolMarkup(text: string): boolean {
  return (
    /<tool_call>|<function=|<\|tool_call\|>/.test(text) ||
    /\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"(arguments|parameters)"\s*:\s*\{[\s\S]*\}\s*$/.test(
      text
    )
  );
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

// Where a turn stopped when the model's server kept failing: what the model
// got done, what it didn't, and what to do next. The error text is scrubbed.
export function failureReport(o: {
  error: string;
  retries: number;
  // The agent retried it before AgentOS saw the error.
  agentRetried?: boolean;
  summary?: TurnSummary;
}): string {
  const kind = classifyProviderError(o.error);
  const why = redact(o.error.replace(/\s+/g, " ").trim()).slice(0, 240);
  const tries = o.retries
    ? ` and ${plural(o.retries, "retry", "retries")} didn't get through`
    : o.agentRetried
      ? " even after the agent retried it"
      : "";
  const s = o.summary;
  const done = s?.steps
    ? `Finished before it stopped: ${plural(s.steps, "tool step")}${s.failed ? ` (${s.failed} failed)` : ""}${
        s.files.length
          ? `; edits to ${s.files
              .map(
                (f) =>
                  `${f.path}${f.failed ? ` (${f.failed} failed${f.ok ? `, ${f.ok} applied` : ""})` : ""}`
              )
              .join(", ")}`
          : ""
      }.`
    : "Nothing had finished yet.";
  return `The model's server ${kind === "timeout" ? "timed out" : "kept failing"} (${why})${tries}. ${done} Not finished: the model's next reply, so the task is incomplete. Send "continue" to resume; the finished steps are kept.`;
}

export const COMPACTION_EMPTY_NOTICE =
  'The model returned nothing after compaction, so the task is incomplete. Retry sends "continue"; the finished steps are kept.';

export const CUT_OFF_NOTICE =
  'The turn stopped right after a tool step, before the model replied, so the task may be incomplete. Retry sends "continue"; the finished steps are kept.';

// Said when a model request got no answer for the whole stall limit.
export function stalledNotice(ms: number, compacting: boolean): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  return `${compacting ? "The model didn't finish compacting the context" : "Model request stalled"}: no response for ${plural(min, "minute")}, so AgentOS stopped waiting. The finished steps are kept. Retry sends "continue".`;
}

export function turnOutcome(r: {
  finishReason?: string;
  text: string;
  toolCalls: number;
  // A compaction ran in this turn.
  compacted?: boolean;
  // Every tool call of the turn has finished.
  toolsDone?: boolean;
  error?: string;
  retries?: number;
  agentRetried?: boolean;
  summary?: TurnSummary;
}): TurnEnded | undefined {
  if (r.finishReason === "length")
    return {
      reason: "length",
      notice:
        "The model hit its output limit (finish reason: length) before it finished. Raise maxTokens for this model.",
    };
  if (r.error)
    return {
      reason: "error",
      notice: classifyProviderError(r.error)
        ? failureReport({
            error: r.error,
            retries: r.retries ?? 0,
            agentRetried: r.agentRetried,
            summary: r.summary,
          })
        : "The model's server returned an error, shown above.",
    };
  if (r.toolCalls > 0)
    return r.toolsDone
      ? { reason: "cut_off", notice: CUT_OFF_NOTICE }
      : undefined;
  if (r.compacted && !r.text.trim())
    return { reason: "compaction_empty", notice: COMPACTION_EMPTY_NOTICE };
  if (hasToolMarkup(r.text))
    return {
      reason: "parse_failure",
      notice: `The model wrote a tool call as text that AgentOS couldn't run. ${SERVER_HINT}`,
    };
  if (!r.text.trim())
    return {
      reason: "empty",
      notice: `The model ended its turn with an empty reply. ${SERVER_HINT}`,
    };
  if (announcesAction(r.text))
    return {
      reason: "no_tool_call",
      notice: `The model ended its turn without calling a tool. ${SERVER_HINT}`,
    };
  return undefined;
}

// One line to diagnose a turn that ended early: where, why and how the
// reply ended. Never the prompt, and the reply's tail is scrubbed and cut.
export function logTurnEnd(o: {
  driver: string;
  provider?: string;
  model?: string;
  api?: string;
  finishReason?: string;
  reason: TurnEndReason;
  text: string;
}): void {
  const tail = redact(
    o.text.slice(-LOG_TAIL).replace(/[\u0000-\u001f\u007f]/g, " ")
  );
  console.warn(
    "[chat] turn ended early",
    JSON.stringify({
      driver: o.driver,
      provider: o.provider,
      model: o.model,
      api: o.api,
      finishReason: o.finishReason,
      reason: o.reason,
      tail,
    })
  );
}

// Asked of the model once when its turn ran tools but ended without the
// report it set out to give.
export const SUMMARY_NUDGE =
  "You ran checks or tools but haven't reported the results. Reply now with a short summary: what worked, what failed (with the exit code or HTTP status) and what you didn't check. Don't run more tools.";

// Appended to the system prompt of agents AgentOS drives itself.
export const RESULTS_BRIEF =
  "After running checks, probes or discovery, end your turn with a results summary: what worked, what failed (exit code or HTTP status) and what you didn't check. Never end on a lead-in such as 'Here's what I found:' without the list.";

// Whether a turn that ran tools ended without telling what they found: an
// empty last reply, or one that only promises the report.
export function needsSummary(r: {
  toolsRun: number;
  text: string;
  toolCalls: number;
  finishReason?: string;
  error?: string;
  aborted?: boolean;
}): boolean {
  if (r.toolsRun === 0 || r.toolCalls > 0 || r.aborted || r.error) return false;
  if (r.finishReason === "length") return false;
  const text = r.text.trim();
  return !text || announcesAction(text) || text.endsWith(":");
}
