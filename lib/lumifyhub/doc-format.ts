// What a repo markdown file becomes as a LumifyHub page: a title, a note that
// it comes from the repo, and the rest of the file.

import { createHash } from "crypto";
import path from "path";

const H1 = /^#\s+(.+?)(?:\s+#+)?\s*$/;
const FENCE = /^\s*(```|~~~)/;
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

// The file's first H1, or its name. An H1 that opens the file is the page's
// title, so it's dropped from the body rather than shown twice.
export function docTitle(
  markdown: string,
  fileName: string
): { title: string; body: string } {
  const text = markdown.replace(FRONTMATTER, "");
  const lines = text.split("\n");
  const first = lines.findIndex((l) => l.trim() !== "");
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (FENCE.test(lines[i])) inFence = !inFence;
    const match = !inFence && H1.exec(lines[i]);
    if (!match) continue;
    const body = i === first ? lines.slice(i + 1).join("\n") : text;
    return { title: match[1].trim(), body: body.replace(/^\s*\n/, "") };
  }
  const base = path.basename(fileName).replace(/\.(md|markdown)$/i, "");
  return { title: base || "Untitled", body: text };
}

// LumifyHub writes a page back with these escaped, and refuses markdown that
// doesn't come back byte for byte, so the note escapes them the same way.
export function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_[\]])/g, "\\$1");
}

export function fromRepoNote(repoPath: string, projectName: string): string {
  return `*From* \`${repoPath}\` *in ${escapeMarkdown(projectName)}. Edit it in the repo; changes here are overwritten.*`;
}

export function publishedMarkdown(input: {
  markdown: string;
  fileName: string;
  repoPath: string;
  projectName: string;
}): { title: string; content: string } {
  const { title, body } = docTitle(input.markdown, input.fileName);
  const note = fromRepoNote(input.repoPath, input.projectName);
  const rest = body.trim();
  return { title, content: rest ? `${note}\n\n${rest}\n` : `${note}\n` };
}

// Over the title and the page body, so renaming the H1 counts as a change.
export function contentHash(page: { title: string; content: string }): string {
  return createHash("sha256")
    .update(`${page.title}\n${page.content}`)
    .digest("hex")
    .slice(0, 16);
}
