/** The task routes a linked machine's AgentOS answers, and how long to wait for each. */

export const taskPath = (id: string, leaf: string) =>
  `/api/tasks/${encodeURIComponent(id)}/${leaf}`;

export const LIST = "/api/tasks";
export const IMPORT = "/api/tasks/import";
export const HELD_REPLIES = "/api/tasks/held-replies";
export const arrivedPath = (from: string) =>
  `/api/tasks/arrived?from=${encodeURIComponent(from)}`;

export const TIMEOUT = {
  list: 8000,
  start: 180000,
  plan: 30000,
  approvePlan: 60000,
  message: 20000,
  hold: 20000,
  chat: 10000,
  stop: 30000,
  done: 120000,
  merge: 300000,
  replies: 8000,
  exportOut: 300000,
  importBundle: 600000,
} as const;
