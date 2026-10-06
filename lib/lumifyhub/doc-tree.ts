// Ordering and filtering the Docs list. Pure, so the browser uses it too.

import type { DocSummary } from "./types";

export interface DocRow {
  doc: DocSummary;
  depth: number;
}

// Parents before their children, each level in the order given. A page whose
// parent isn't in the list (a board, or a page the token can't see) is a root.
export function docTree(docs: DocSummary[]): DocRow[] {
  const ids = new Set(docs.map((d) => d.id));
  const children = new Map<string | null, DocSummary[]>();
  for (const doc of docs) {
    const parent = doc.parentId && ids.has(doc.parentId) ? doc.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), doc]);
  }
  const rows: DocRow[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const doc of children.get(parent) ?? []) {
      if (seen.has(doc.id)) continue;
      seen.add(doc.id);
      rows.push({ doc, depth });
      walk(doc.id, depth + 1);
    }
  };
  walk(null, 0);
  // A parent loop would hide its pages; show them as roots instead.
  for (const doc of docs) if (!seen.has(doc.id)) rows.push({ doc, depth: 0 });
  return rows;
}

export function matchesQuery(title: string, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = title.toLowerCase();
  return words.every((w) => hay.includes(w));
}

// A search shows a flat list; no search shows the tree.
export function docRows(docs: DocSummary[], query: string): DocRow[] {
  if (!query.trim()) return docTree(docs);
  return docs
    .filter((d) => matchesQuery(d.title, query))
    .map((doc) => ({ doc, depth: 0 }));
}

export function isMarkdownPath(file: string): boolean {
  return /\.(md|markdown)$/i.test(file);
}
