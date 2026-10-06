// What the UI sees of a stack. No server imports: the browser reads these.

import type { StackItemStatus, StackStatus } from "../db/stacks";

export type { StackItemStatus, StackStatus };

export interface StackItemView {
  id: string;
  cardId: string;
  ticket: string | null;
  title: string;
  status: StackItemStatus | "done" | "excluded";
  depth: number;
  parentId: string | null;
  // Other blockers, whose work is not in this item's base.
  also: string[];
  waitsOn: string | null;
  note: string | null;
  // Needs attention: what went wrong and the exact command to fix it.
  error: string | null;
  taskId: string | null;
  prNumber: number | null;
  prUrl: string | null;
  baseBranch: string | null;
  cardUrl: string | null;
}

export interface StackView {
  id: string;
  name: string;
  status: StackStatus;
  projectId: string;
  projectName: string | null;
  maxParallel: number;
  progress: string | null;
  error: string | null;
  createdAt: string;
  landedAt: string | null;
  items: StackItemView[];
}

export interface StackPreview {
  projectId: string;
  projectName: string;
  boardName: string | null;
  items: StackItemView[];
}
