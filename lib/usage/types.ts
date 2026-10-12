/** Pure usage-ledger types, shared with the mobile app: no imports, nothing server-only. */

export type CallKind = "main" | "sub" | "review" | "gate" | "helper";
export type CallSource = "live" | "transcript" | "check_run" | "helper";

export interface CallRow {
  callKey: string;
  at: number;
  sessionId: string | null;
  taskId: string | null;
  workspaceId: string | null;
  projectId: string | null;
  sessionName: string | null;
  role: string | null;
  kind: CallKind;
  agentType: string | null;
  model: string | null;
  provider: string;
  input: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  output: number;
  ctx: number | null;
  source: CallSource;
}

// What a driver reports for one response, before it's tied to a session.
export type CallUsage = Pick<
  CallRow,
  | "callKey"
  | "at"
  | "kind"
  | "agentType"
  | "model"
  | "input"
  | "cacheRead"
  | "cacheWrite5m"
  | "cacheWrite1h"
  | "output"
>;
