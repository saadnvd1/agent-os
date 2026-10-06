import type Database from "better-sqlite3";

// A repo file published as a LumifyHub page. Re-publishing updates the page.
export interface LumifyHubPublishedDoc {
  project_id: string;
  repo_path: string;
  page_id: string;
  content_hash: string;
  published_at: string;
}

export const lumifyhubDocQueries = {
  publishedDocs: (db: Database.Database, projectId: string) =>
    db
      .prepare(
        `SELECT * FROM lumifyhub_published_docs WHERE project_id = ? ORDER BY repo_path`
      )
      .all(projectId) as LumifyHubPublishedDoc[],

  publishedDoc: (db: Database.Database, projectId: string, repoPath: string) =>
    (db
      .prepare(
        `SELECT * FROM lumifyhub_published_docs WHERE project_id = ? AND repo_path = ?`
      )
      .get(projectId, repoPath) as LumifyHubPublishedDoc | undefined) ?? null,

  savePublishedDoc: (
    db: Database.Database,
    d: Omit<LumifyHubPublishedDoc, "published_at">
  ) =>
    db
      .prepare(
        `INSERT INTO lumifyhub_published_docs (project_id, repo_path, page_id, content_hash, published_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(project_id, repo_path) DO UPDATE SET page_id = excluded.page_id,
           content_hash = excluded.content_hash, published_at = excluded.published_at`
      )
      .run(d.project_id, d.repo_path, d.page_id, d.content_hash),
};
