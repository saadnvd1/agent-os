// Builds, stores and serves a task's health report. Evidence first (server
// code), words second (the analyst model), then every claim is checked and
// the estimate is computed here. Cached on an evidence hash; one generation
// per task at a time.

import { db, type Session } from "../db";
import type { ClaudeRunner } from "../orchestrator/claude-cli";
import type { RunUsage } from "../usage/check-runs";
import { isFinished } from "../tasks/state";
import { gather, type Gathered } from "./evidence/gather";
import { computeEstimate } from "./estimate";
import { askModel, evidencePack } from "./model";
import { modeOf, workspaceOf } from "./mode";
import { hashOfLatest, insertReport, latestReport } from "./store";
import { headlineFor, templateLines } from "./template";
import { validateModelReport } from "./validate";
import type { HealthReport, ReportTrigger } from "./types";
import { notifyTopic } from "../status/hub";

export const reportTopic = (sessionId: string) => `report:${sessionId}`;

const inFlight = new Map<string, Promise<HealthReport>>();
export const isGenerating = (sessionId: string) => inFlight.has(sessionId);

export interface GenerateOptions {
  analystSummary?: string | null;
  runner?: ClaudeRunner;
  // Build a new report even when the evidence is unchanged.
  force?: boolean;
}

export function buildReport(
  s: Pick<Session, "id" | "name" | "task_prompt">,
  g: Gathered,
  trigger: ReportTrigger,
  raw: unknown | null,
  usage: RunUsage | null
): Omit<HealthReport, "id" | "createdAt" | "stale"> {
  const v = raw === null ? null : validateModelReport(raw, g.evidence);
  const fromModel = !!v && (v.lines.length > 0 || !!v.recommendation);
  const tmpl = templateLines(g.state, g.evidence);
  const estimate = computeEstimate({
    head: g.head,
    evidence: g.evidence,
    items: g.items,
    mappings: v?.mappings ?? [],
    stages: g.stages,
  });
  const mode = modeOf(s.id).mode;
  const finished = isFinished(g.state);
  const text = mode !== "manual" && !finished ? (v?.nextPrompt ?? null) : null;
  const draft =
    mode === "manual" || finished
      ? null
      : (g.analystDraft ??
        (text
          ? {
              source: "report" as const,
              id: "",
              text,
              status: "pending" as const,
            }
          : null));
  return {
    sessionId: s.id,
    workspaceId: workspaceOf(s.id),
    head: g.head,
    trigger,
    headline: (fromModel && v?.headline) || headlineFor(g.state),
    state: g.state,
    estimate,
    lines: fromModel ? v!.lines : tmpl.lines,
    recommendation: fromModel ? v!.recommendation : tmpl.recommendation,
    draft,
    evidence: g.evidence,
    source: fromModel ? "model" : "template",
    dropped: v?.dropped ?? 0,
    model: usage?.model ?? null,
    costUsd: usage?.costUsd ?? null,
  };
}

async function run(
  sessionId: string,
  trigger: ReportTrigger,
  opts: GenerateOptions
): Promise<HealthReport> {
  const s = db
    .prepare(`SELECT * FROM session_rows WHERE id = ?`)
    .get(sessionId) as Session | undefined;
  if (!s) throw new Error("No such task");
  const g = await gather(s, { analystSummary: opts.analystSummary });
  const last = latestReport(sessionId, g.head);
  // The same evidence needs no new report, and a task's end report is final.
  if (
    last &&
    !opts.force &&
    (hashOfLatest(sessionId) === g.hash ||
      (last.trigger === "end" && isFinished(g.state)))
  )
    return last;

  let raw: unknown = null;
  let usage: RunUsage | null = null;
  try {
    raw = await askModel(
      {
        prompt: evidencePack(
          { name: s.name, prompt: s.task_prompt ?? "" },
          g.state,
          g.evidence,
          g.items
        ),
        workspaceId: workspaceOf(sessionId),
        onUsage: (u) => (usage = u),
      },
      opts.runner
    );
  } catch (error) {
    console.error(`Report for ${s.name}:`, error);
  }
  const report = buildReport(s, g, trigger, raw, usage);
  const id = insertReport(report, g.hash);
  notifyTopic(reportTopic(sessionId));
  return (
    latestReport(sessionId, g.head) ?? {
      ...report,
      id,
      createdAt: "",
      stale: false,
    }
  );
}

// One generation per task: a request while one runs shares its result.
export function generateReport(
  sessionId: string,
  trigger: ReportTrigger,
  opts: GenerateOptions = {}
): Promise<HealthReport> {
  const running = inFlight.get(sessionId);
  if (running) return running;
  const p = run(sessionId, trigger, opts).finally(() =>
    inFlight.delete(sessionId)
  );
  inFlight.set(sessionId, p);
  return p;
}

// The trigger entry the loop and the task hooks use: fire and forget.
export function requestReport(
  sessionId: string,
  trigger: ReportTrigger,
  opts: GenerateOptions & { cycleId?: number } = {}
): void {
  generateReport(sessionId, trigger, opts).catch((error) =>
    console.error(`Report ${sessionId}:`, error)
  );
}
