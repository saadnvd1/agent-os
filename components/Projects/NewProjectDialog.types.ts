import type { AgentType } from "@/lib/providers";

export const CLONE_STEP = {
  IDLE: "idle",
  CLONING: "cloning",
  CREATING: "creating",
  DONE: "done",
} as const;

export type CloneStep = (typeof CLONE_STEP)[keyof typeof CLONE_STEP];

export interface DevServerConfig {
  id: string;
  name: string;
  type: "node" | "docker";
  command: string;
  port?: number;
  portEnvVar?: string;
}

export interface NewProjectDialogProps {
  open: boolean;
  mode?: "new" | "clone";
  onClose: () => void;
  onCreated: (projectId: string) => void;
}

export const RECENT_DIRS_KEY = "agentOS:recentDirectories";
export const MAX_RECENT_DIRS = 5;

export const AGENT_OPTIONS: { value: AgentType; label: string }[] = [
  { value: "claude", label: "Claude Code" },
  { value: "codex", label: "Codex" },
  { value: "opencode", label: "OpenCode" },
  { value: "gemini", label: "Gemini CLI" },
  { value: "aider", label: "Aider" },
  { value: "cursor", label: "Cursor CLI" },
  { value: "amp", label: "Amp" },
];

export const MODEL_OPTIONS = [
  { value: "sonnet", label: "Sonnet" },
  { value: "opus", label: "Opus" },
  { value: "haiku", label: "Haiku" },
];

export function extractRepoName(url: string): string | null {
  const match = url.match(
    /(?:github\.com[/:][\w.-]+\/([\w.-]+?)(?:\.git)?|^([\w.-]+)\.git)$/
  );
  return match ? match[1] || match[2] || null : null;
}
