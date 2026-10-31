// Data, not logic: which commits never reach the changelog, and what a
// scope is called to a person.

export const VISIBLE_TYPES = ["feat", "fix", "perf"];

// Internal plumbing and anything security-scoped: hidden entirely, even when
// the PR body carries a line.
export const HIDDEN_SCOPES = [
  "deps",
  "security",
  "health",
  "orchestrator",
  "tasks",
  "loops",
  "db",
  "deploy",
  "gate",
  "bus",
  "peer",
  "claims",
  "package",
  "test",
  "tests",
  "ci",
  "stall",
  "doctor",
  "audit",
  "audits",
];

export const AREAS: Record<string, string> = {
  chat: "Chat",
  sidebar: "Sidebar",
  sessions: "Sessions",
  session: "Sessions",
  live: "Live sharing",
  share: "Sharing",
  connect: "Connect",
  models: "Models",
  picker: "Models",
  copilot: "Models",
  config: "Settings",
  settings: "Settings",
  terminal: "Terminal",
  mobile: "Phone",
  ui: "Interface",
  composer: "Composer",
  drafts: "Drafts",
  done: "Done shelf",
  worktrees: "Worktrees",
  welcome: "Setup",
  updates: "Updates",
  usage: "Usage",
  push: "Notifications",
  notify: "Notifications",
  hosts: "Machines",
  machines: "Machines",
  schedules: "Schedules",
  artifacts: "Artifacts",
  simulator: "Simulator",
  status: "Status",
  away: "Away mode",
  plans: "Plans",
  lumifyhub: "LumifyHub",
  demo: "Demo",
  cli: "Command line",
  analyst: "Analyst",
};

export const FALLBACK_AREA = "AgentOS";

export const areaOf = (scope: string | null): string =>
  (scope && AREAS[scope.toLowerCase()]) || FALLBACK_AREA;

export const isHiddenScope = (scope: string | null): boolean =>
  !!scope && HIDDEN_SCOPES.includes(scope.toLowerCase());
