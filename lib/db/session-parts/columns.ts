import type { Session } from "@/lib/db/types";

// The sessions columns that live in their own tables, by concern. Each table
// is keyed by session_id and holds a row only for a session that has a value
// in the group; `session_rows` joins them back into the flat shape of a
// session. See docs/decisions/2026-10-15-split-sessions-table.md.
export const PART_COLUMNS = {
  session_tasks: [
    "task_prompt",
    "task_brief",
    "task_status",
    "task_since",
    "task_ended_at",
    "merged_at",
    "priority",
    "quick_of",
    "moved_to",
    "moved_from",
    "model_overrides",
    "lh_card_id",
    "lh_board_id",
    "lh_card_list",
  ],
  session_prs: [
    "pr_url",
    "pr_number",
    "pr_status",
    "merge_armed_at",
    "merge_armed_seen",
    "rebased_from",
    "rebased_to",
    "rebase_asked_head",
    "pr_wake_since",
  ],
  session_plans: [
    "plan_phase",
    "plan_only",
    "plan_decided",
    "plan_reason",
    "plan_note",
    "plan_edits",
    "plan_waits_for_caller",
    "plan_handoff_message",
  ],
  session_placement: [
    "peer_mirror",
    "placed_note",
    "held_by_device",
    "held_from",
    "held_for",
    "held_for_name",
    "started_by_device",
  ],
  session_pauses: ["pause_state", "paused_until", "pause_id", "pause_note"],
} as const satisfies Record<string, readonly (keyof Session)[]>;

export type PartTable = keyof typeof PART_COLUMNS;
export type PartColumn<T extends PartTable> = (typeof PART_COLUMNS)[T][number];
export type PartPatch<T extends PartTable> = {
  [C in PartColumn<T>]?: Session[C & keyof Session];
};

export const PART_TABLES = Object.keys(PART_COLUMNS) as PartTable[];

// Everything else is an INTEGER or TEXT by this list.
export const INTEGER_COLUMNS: ReadonlySet<string> = new Set([
  "pr_number",
  "plan_only",
  "plan_decided",
  "plan_waits_for_caller",
  "peer_mirror",
  "pause_id",
]);

const partOfColumn = new Map<string, PartTable>(
  PART_TABLES.flatMap((t) =>
    (PART_COLUMNS[t] as readonly string[]).map((c) => [c, t] as const)
  )
);

export const isMovedColumn = (column: string): boolean =>
  partOfColumn.has(column);

export const partOf = (column: string): PartTable | undefined =>
  partOfColumn.get(column);

// The shape of a session row and of `session_rows`, in order: the sessions
// columns and the moved ones where they always stood. A migration that adds a
// sessions column adds it here and rebuilds the view (createSessionRowsView).
export const SESSION_ROW_COLUMNS: readonly string[] = [
  "id",
  "name",
  "created_at",
  "updated_at",
  "status",
  "working_directory",
  "parent_session_id",
  "claude_session_id",
  "model",
  "system_prompt",
  "group_path",
  "agent_type",
  "worktree_path",
  "branch_name",
  "base_branch",
  "dev_server_port",
  "pr_url",
  "pr_number",
  "pr_status",
  "conductor_session_id",
  "worker_task",
  "worker_status",
  "auto_approve",
  "project_id",
  "tmux_name",
  "host_id",
  "task_prompt",
  "task_status",
  "view",
  "lh_card_id",
  "lh_board_id",
  "lh_card_list",
  "chat_access",
  "chat_resume_at",
  "last_seen_at",
  "role",
  "workspace_id",
  "orch_token",
  "archived_at",
  "pinned",
  "chat_suggestion",
  "chat_plan",
  "chat_context",
  "chat_usage",
  "name_source",
  "setup_status",
  "setup_ms",
  "setup_error",
  "task_brief",
  "moved_to",
  "moved_from",
  "port_slot",
  "ports",
  "database",
  "peer_mirror",
  "chat_restarted",
  "chat_tools_digest",
  "merge_armed_at",
  "merge_armed_seen",
  "rebased_from",
  "rebased_to",
  "rebase_asked_head",
  "chat_refreshed",
  "pr_wake_since",
  "merged_at",
  "task_ended_at",
  "model_provider",
  "model_overrides",
  "plan_phase",
  "quick_of",
  "started_by",
  "plan_decided",
  "plan_reason",
  "task_since",
  "held_by_device",
  "held_from",
  "plan_note",
  "held_for",
  "held_for_name",
  "plan_only",
  "plan_edits",
  "active_at",
  "settled_at",
  "snoozed_until",
  "snoozed_at",
  "priority",
  "pause_state",
  "paused_until",
  "pause_id",
  "placed_note",
  "started_by_device",
  "pause_note",
  "started_via",
  "plan_waits_for_caller",
  "plan_handoff_message",
];
