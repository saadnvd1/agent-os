// What the environment-failure detector knows and shows. Plain data, no I/O.

export interface EnvClass {
  id: string;
  label: string;
  // shell: only shell tools' output; guard: any tool's refused call.
  scope: "shell" | "guard";
  // Any of these, tested per line.
  match: RegExp[];
  // Also has to hold, tested on the whole output.
  requires?: RegExp;
  // Vetoes: a command or output that shows it isn't this machine's fault.
  except?: { command?: RegExp; output?: RegExp };
  // Sent once to a session that hit it; null means record and escalate only.
  fix: string | null;
}

export interface EnvHit {
  class: string;
  line: string;
  command: string;
}

export interface EnvFailureRow {
  id: number;
  session_id: string;
  class: string;
  project_id: string | null;
  workspace_id: string | null;
  command: string | null;
  line: string | null;
  last_item_id: string | null;
  hits: number;
  first_at: number;
  last_at: number;
  nudged_at: number | null;
  nudge_skipped: string | null;
  alerted: string | null;
  alerted_at: number | null;
}

export interface EnvClassView {
  id: string;
  label: string;
  fix: string | null;
  fixOverridden: boolean;
  sessions7: number;
  sessions30: number;
  projects: {
    id: string | null;
    name: string;
    sessions7: number;
    sessions30: number;
  }[];
}

export interface EnvSummary {
  now: number;
  classes: EnvClassView[];
}

export interface EnvSessionView {
  sessionId: string;
  name: string;
  project: string | null;
  command: string | null;
  line: string | null;
  hits: number;
  firstAt: number;
  lastAt: number;
  // "sent", or why not.
  fix: string;
}
