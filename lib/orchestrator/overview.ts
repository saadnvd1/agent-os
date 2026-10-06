/**
 * What the sidebar and the orchestrator's chat show for each workspace: its
 * open asks, whether it's paused, and how many tasks are in review. Running
 * counts come from the live session statuses on the client.
 */

import { db } from "../db";
import { listWorkspaces } from "../workspaces";
import { openAsks, type AskKind } from "./asks";
import { getOrchestrator } from "./home";

export interface AskView {
  id: number;
  kind: AskKind;
  title: string;
  why: string;
  detail: string;
  link: string | null;
  createdAt: string;
}

export interface OrchestratorOverview {
  workspaceId: string;
  sessionId: string | null;
  paused: boolean;
  inReview: number;
  asks: AskView[];
}

// The fence around text other sessions wrote is for the orchestrator; Saad
// reads it plain.
export const plain = (text: string) =>
  text.replace(/<\/?untrusted(?:\s+source="[^"]*")?>/g, "").trim();

function inReview(workspaceId: string): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM sessions s JOIN projects p ON p.id = s.project_id
         WHERE p.workspace_id = ? AND s.role IS NULL
           AND s.task_status = 'running' AND s.pr_status = 'open'`
      )
      .get(workspaceId) as { n: number }
  ).n;
}

export function orchestratorOverview(): OrchestratorOverview[] {
  return listWorkspaces().map((w) => ({
    workspaceId: w.id,
    sessionId: getOrchestrator(w.id)?.id ?? null,
    paused: !!w.orch_paused_at,
    inReview: inReview(w.id),
    asks: openAsks(w.id).map((a) => {
      const detail = plain(a.detail);
      return {
        id: a.id,
        kind: a.kind,
        title: a.title,
        why: detail.split("\n")[0] ?? "",
        detail,
        link: a.link,
        createdAt: a.created_at,
      };
    }),
  }));
}
