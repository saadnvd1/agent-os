/**
 * Repo markdown → LumifyHub page, one way (docs/lumifyhub.md). Publishing
 * creates the page; publishing again, or merging a task that changed the
 * file, overwrites it.
 */

import fs from "fs/promises";
import path from "path";
import {
  db,
  lumifyhubDocQueries as q,
  type Project,
  type Session,
} from "../db";
import { getProject } from "../projects";
import { run } from "../tasks/gh";
import { LumifyHubError } from "./client";
import { requireClient } from "./connection";
import { linkedWorkspaceFor } from "./links";
import { createPage, updatePage } from "./pages";
import { pageUrl } from "./urls";
import { contentHash, publishedMarkdown } from "./doc-format";
import { isMarkdownPath } from "./doc-tree";
import type { PublishedDoc } from "./types";

function localProject(projectId: string): Project {
  const project = getProject(projectId);
  if (!project || project.is_uncategorized) throw new Error("Unknown project");
  if (project.host_id && project.host_id !== "local") {
    throw new Error("Publishing works for projects on this machine");
  }
  return project;
}

const git = (dir: string, ...args: string[]) =>
  run("git", args, dir).then((out) => out.trim());

async function commonDir(dir: string): Promise<string | null> {
  return git(dir, "rev-parse", "--path-format=absolute", "--git-common-dir")
    .then((d) => path.resolve(d))
    .catch(() => null);
}

// The file's path in the repo. It may sit in the project's checkout or in one
// of its task worktrees: both share the project's git directory.
async function repoPathFor(project: Project, file: string): Promise<string> {
  const dir = path.dirname(file);
  const [mine, theirs] = await Promise.all([
    commonDir(project.working_directory),
    commonDir(dir),
  ]);
  let root = project.working_directory;
  if (mine && theirs === mine) {
    root = await git(dir, "rev-parse", "--show-toplevel");
  }
  const rel = path.relative(path.resolve(root), path.resolve(file));
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("That file isn't in this project");
  }
  return rel.split(path.sep).join("/");
}

async function publish(
  project: Project,
  repoPath: string,
  markdown: string,
  onlyIfChanged: boolean
): Promise<{ pageId: string; changed: boolean }> {
  const workspace = linkedWorkspaceFor(project);
  const page = publishedMarkdown({
    markdown,
    fileName: repoPath,
    repoPath,
    projectName: project.name,
  });
  const hash = contentHash(page);
  const existing = q.publishedDoc(db, project.id, repoPath);
  if (existing && onlyIfChanged && existing.content_hash === hash) {
    return { pageId: existing.page_id, changed: false };
  }
  const client = requireClient();
  let pageId: string | null = null;
  if (existing) {
    try {
      pageId = (await updatePage(client, existing.page_id, page)).id;
    } catch (error) {
      // Deleted in LumifyHub: publish it afresh.
      if (!(error instanceof LumifyHubError && error.status === 404)) {
        throw error;
      }
    }
  }
  if (!pageId) {
    pageId = (
      await createPage(client, {
        workspace_slug: workspace.lh_workspace_slug!,
        ...page,
      })
    ).id;
  }
  q.savePublishedDoc(db, {
    project_id: project.id,
    repo_path: repoPath,
    page_id: pageId,
    content_hash: hash,
  });
  return { pageId, changed: true };
}

export async function publishFile(
  projectId: string,
  file: string
): Promise<PublishedDoc> {
  if (!file || !path.isAbsolute(file) || !isMarkdownPath(file)) {
    throw new Error("Only markdown files can be published");
  }
  const project = localProject(projectId);
  const repoPath = await repoPathFor(project, file);
  const markdown = await fs.readFile(file, "utf8");
  await publish(project, repoPath, markdown, false);
  return publishedDocs(projectId).find((d) => d.repoPath === repoPath)!;
}

export function publishedDocs(projectId: string): PublishedDoc[] {
  const project = localProject(projectId);
  let slug: string | null = null;
  try {
    slug = linkedWorkspaceFor(project).lh_workspace_slug;
  } catch {
    return [];
  }
  const baseUrl = requireClient().baseUrl;
  return q.publishedDocs(db, project.id).map((d) => ({
    repoPath: d.repo_path,
    pageId: d.page_id,
    url: pageUrl(baseUrl, slug!, d.page_id),
    publishedAt: d.published_at,
  }));
}

// After a task merges: re-publish the project's published files whose merged
// content changed. Read from the base branch the PR merged into, not the
// checkout, which may be on another branch or behind.
export async function republishAfterMerge(session: Session): Promise<number> {
  const project = session.project_id ? getProject(session.project_id) : null;
  if (!project?.working_directory) return 0;
  const docs = q.publishedDocs(db, project.id);
  if (!docs.length) return 0;
  const repo = project.working_directory;
  const base =
    session.base_branch ||
    (await git(repo, "rev-parse", "--abbrev-ref", "origin/HEAD")
      .then((ref) => ref.replace(/^origin\//, ""))
      .catch(() => "main"));
  let changed = 0;
  for (const doc of docs) {
    const markdown = await git(
      repo,
      "show",
      `origin/${base}:${doc.repo_path}`
    ).catch(() => null);
    if (markdown === null) continue; // removed from the repo: leave the page
    const result = await publish(project, doc.repo_path, markdown, true);
    if (result.changed) changed++;
  }
  return changed;
}
