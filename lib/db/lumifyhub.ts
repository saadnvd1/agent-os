import type Database from "better-sqlite3";

// The one LumifyHub account this AgentOS is connected to. The token never
// leaves the server: callers that talk to the UI map this to a status.
export interface LumifyHubConnection {
  base_url: string;
  token: string;
  user_id: string | null;
  user_email: string | null;
  user_name: string | null;
  connected_at: string;
}

export interface LumifyHubConnectAttempt {
  state: string;
  verifier: string;
  redirect_uri: string;
  created_at: string;
}

export const ATTEMPT_TTL_MINUTES = 10;

export const lumifyhubQueries = {
  getConnection: (db: Database.Database) =>
    (db.prepare(`SELECT * FROM lumifyhub_connection WHERE id = 1`).get() as
      | LumifyHubConnection
      | undefined) ?? null,

  saveConnection: (
    db: Database.Database,
    c: Omit<LumifyHubConnection, "connected_at">
  ) =>
    db
      .prepare(
        `INSERT INTO lumifyhub_connection (id, base_url, token, user_id, user_email, user_name, connected_at)
         VALUES (1, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET base_url = excluded.base_url, token = excluded.token,
           user_id = excluded.user_id, user_email = excluded.user_email,
           user_name = excluded.user_name, connected_at = excluded.connected_at`
      )
      .run(c.base_url, c.token, c.user_id, c.user_email, c.user_name),

  deleteConnection: (db: Database.Database) =>
    db.prepare(`DELETE FROM lumifyhub_connection`).run(),

  createAttempt: (
    db: Database.Database,
    a: Omit<LumifyHubConnectAttempt, "created_at">
  ) => {
    db.prepare(
      `DELETE FROM lumifyhub_connect_attempts WHERE created_at < datetime('now', ?)`
    ).run(`-${ATTEMPT_TTL_MINUTES} minutes`);
    db.prepare(
      `INSERT INTO lumifyhub_connect_attempts (state, verifier, redirect_uri) VALUES (?, ?, ?)`
    ).run(a.state, a.verifier, a.redirect_uri);
  },

  // Single use: the attempt is gone whether or not it was still fresh.
  takeAttempt: (db: Database.Database, state: string) =>
    db.transaction(() => {
      const row = db
        .prepare(
          `SELECT *, created_at >= datetime('now', ?) AS fresh
           FROM lumifyhub_connect_attempts WHERE state = ?`
        )
        .get(`-${ATTEMPT_TTL_MINUTES} minutes`, state) as
        | (LumifyHubConnectAttempt & { fresh: number })
        | undefined;
      db.prepare(`DELETE FROM lumifyhub_connect_attempts WHERE state = ?`).run(
        state
      );
      if (!row?.fresh) return null;
      return {
        state: row.state,
        verifier: row.verifier,
        redirect_uri: row.redirect_uri,
        created_at: row.created_at,
      };
    })(),

  linkWorkspace: (
    db: Database.Database,
    id: string,
    lh: { id: string; slug: string; name: string } | null
  ) =>
    db
      .prepare(
        `UPDATE workspaces SET lh_workspace_id = ?, lh_workspace_slug = ?, lh_workspace_name = ? WHERE id = ?`
      )
      .run(lh?.id ?? null, lh?.slug ?? null, lh?.name ?? null, id),

  linkProjectBoard: (
    db: Database.Database,
    projectId: string,
    board: { id: string; title: string; pageId: string | null } | null
  ) =>
    db
      .prepare(
        `UPDATE projects SET lh_board_id = ?, lh_board_name = ?, lh_board_page_id = ? WHERE id = ?`
      )
      .run(
        board?.id ?? null,
        board?.title ?? null,
        board?.pageId ?? null,
        projectId
      ),

  // Unlinking a workspace leaves its projects' boards meaningless.
  unlinkWorkspaceBoards: (db: Database.Database, workspaceId: string) =>
    db
      .prepare(
        `UPDATE projects SET lh_board_id = NULL, lh_board_name = NULL, lh_board_page_id = NULL WHERE workspace_id = ?`
      )
      .run(workspaceId),

  linkTaskCard: (
    db: Database.Database,
    sessionId: string,
    card: { cardId: string; boardId: string; list: string }
  ) =>
    db
      .prepare(
        `UPDATE sessions SET lh_card_id = ?, lh_board_id = ?, lh_card_list = ? WHERE id = ?`
      )
      .run(card.cardId, card.boardId, card.list, sessionId),

  setTaskCardList: (db: Database.Database, sessionId: string, list: string) =>
    db
      .prepare(`UPDATE sessions SET lh_card_list = ? WHERE id = ?`)
      .run(list, sessionId),

  linkedCardIds: (db: Database.Database, boardId: string) =>
    new Set(
      (
        db
          .prepare(
            `SELECT lh_card_id FROM sessions WHERE lh_board_id = ? AND lh_card_id IS NOT NULL`
          )
          .all(boardId) as { lh_card_id: string }[]
      ).map((r) => r.lh_card_id)
    ),
};
