// Reads everything a report is built from: the task's state, its checks and
// review, the diff, the plan, the tests it ran, what waits on a human and,
// once merged, its log. No model is involved.

import fs from "fs/promises";
import path from "path";
import { git } from "../../git-exec";
import { db, type Session } from "../../db";
import { taskView } from "../../tasks";
import { taskChecks } from "../../tasks/checks-view";
import { expandHome, localWorktree } from "../../tasks/session";
import { PLAN_FILE } from "../../models/plan-step";
import { parseAcceptance } from "../../plans/acceptance";
import { lastItems } from "../../chat/store";
import { turnSignals } from "../../analyst/signals";
import { getLog, headerOf } from "../../session-logs/store";
import { pieceOfSession } from "../../plans/features";
import { liveLinkFor, listRecommendations } from "../../analyst/store";
import { criteriaOf, latestLoopFor } from "../../loops/store";
import { isFinished, type TaskState } from "../../tasks/state";
import { scrub } from "../../session-audit/normalize";
import type { AcceptanceItem, Stages } from "../estimate";
import type { EvidenceRef, NextPromptDraft } from "../types";
import {
  acceptEvidence,
  askEvidence,
  ciEvidence,
  diffEvidence,
  evidenceHash,
  logEvidence,
  reviewEvidence,
  stateEvidence,
  testEvidence,
} from "./build";

export interface Gathered {
  state: TaskState;
  head: string | null;
  evidence: EvidenceRef[];
  hash: string;
  items: AcceptanceItem[];
  stages: Stages;
  analystDraft: NextPromptDraft | null;
}

async function readPlan(s: Session): Promise<string | null> {
  const dir = s.worktree_path ? expandHome(s.worktree_path) : null;
  if (!dir) return null;
  try {
    return await fs.readFile(path.join(dir, PLAN_FILE), "utf8");
  } catch {
    return null;
  }
}

async function numstat(s: Session): Promise<string> {
  const dir = localWorktree(s);
  if (!dir) return "";
  const base = (s.base_branch ?? "main").replace(/^origin\//, "");
  try {
    return await git(dir, ["diff", "--numstat", `origin/${base}...HEAD`], {
      timeout: 10_000,
    });
  } catch {
    return "";
  }
}

function openAsks(s: Session) {
  if (!s.workspace_id) return [];
  return db
    .prepare(
      `SELECT id, title, detail, created_at FROM orchestrator_asks
        WHERE workspace_id = ? AND subject = ? AND status = 'open'`
    )
    .all(s.workspace_id, `task:${s.id}`) as {
    id: number;
    title: string;
    detail: string;
    created_at: string;
  }[];
}

export async function gather(
  s: Session,
  extra?: { analystSummary?: string | null }
): Promise<Gathered> {
  const at = new Date().toISOString();
  const [view, checks, plan, stat] = await Promise.all([
    taskView(s),
    taskChecks(s, { logs: true }).catch(() => null),
    readPlan(s),
    numstat(s),
  ]);
  const head = checks?.pr?.head ?? view.pr?.head ?? null;
  const evidence: EvidenceRef[] = [
    stateEvidence(view.state, view.blocked, at),
    ...ciEvidence(checks?.checks ?? [], head, at),
    ...reviewEvidence(checks?.review ?? null),
    ...diffEvidence(stat, s.id, at),
    ...askEvidence(openAsks(s)),
  ];

  if (s.view === "chat")
    evidence.push(
      ...testEvidence(turnSignals(lastItems(s.id, 600)), s.id, head, at)
    );

  const piece = pieceOfSession(s.id);
  if (piece)
    evidence.push({
      id: `piece:${piece.position}`,
      kind: "piece",
      label: `Piece "${piece.name}" is ${piece.status}`,
      status:
        piece.status === "merged"
          ? "pass"
          : piece.status === "blocked"
            ? "fail"
            : "info",
      at,
    });

  if (extra?.analystSummary)
    evidence.push({
      id: "state:analyst",
      kind: "state",
      label: "The analyst's summary of the last cycle",
      status: "info",
      at,
      excerpt: scrub(extra.analystSummary).slice(0, 1500),
    });

  const log = isFinished(view.state) ? getLog(s.id) : null;
  if (log) {
    const h = headerOf(log);
    evidence.push(
      logEvidence({
        sessionId: s.id,
        mergeCommit: h.mergeCommit,
        prNumber: h.prNumber,
        durationMs: h.durationMs,
        costUsd: h.costUsd,
        createdAt: h.createdAt,
      })
    );
  }

  // Acceptance: the plan's checklist, else the loop's criteria. A loop
  // criterion is met only when its cited evidence resolved (verified).
  let items: AcceptanceItem[] = [];
  const planItems = parseAcceptance(plan);
  if (planItems.length) {
    items = planItems.map((label) => ({ label }));
    evidence.push(
      ...acceptEvidence(
        planItems.map((label) => ({ label, met: false })),
        at
      )
    );
  } else {
    const loop = latestLoopFor(s.id);
    const crit = loop
      ? criteriaOf(loop.id).filter((c) => c.status !== "waived")
      : [];
    if (crit.length) {
      const met = (c: (typeof crit)[number]) =>
        c.status === "met" && c.verified;
      evidence.push(
        ...acceptEvidence(
          crit.map((c) => ({
            label: c.text,
            met: met(c),
            note: c.evidence?.note,
          })),
          at
        )
      );
      items = crit.map((c, i) => ({
        label: c.text,
        evidence: met(c) ? [`accept:${i + 1}`] : undefined,
      }));
    }
  }

  const merged = view.state === "merged";
  const pr = checks?.pr ?? null;
  const ci = evidence.filter((e) => e.kind === "ci");
  const stages: Stages = {
    planned:
      !!plan ||
      s.plan_phase === "implementing" ||
      s.plan_phase === "handoff" ||
      !!pr,
    pushed: !!pr || evidence.some((e) => e.kind === "diff"),
    prOpen: !!pr,
    ciGreen: ci.length > 0 && ci.every((e) => e.status === "pass"),
    reviewed: evidence.some((e) => e.kind === "review" && e.status === "pass"),
    merged,
  };

  return {
    state: view.state,
    head,
    evidence,
    hash: evidenceHash(evidence, head),
    items,
    stages,
    analystDraft: analystDraft(s.id),
  };
}

// The analyst's open recommendation with a prompt, when the task has one.
export function analystDraft(sessionId: string): NextPromptDraft | null {
  const link = liveLinkFor(sessionId);
  if (!link) return null;
  const rec = listRecommendations(link.id, 5).find(
    (r) => r.state === "open" && r.prompt
  );
  return rec
    ? {
        source: "analyst",
        id: rec.id,
        text: rec.prompt!,
        status: "pending",
        linkId: link.id,
      }
    : null;
}
