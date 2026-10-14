import type { SessionInput, Step } from "../types";

export const bash = (
  command: string,
  o: { ok?: boolean; output?: string } = {}
): Step => ({
  kind: "tool",
  name: "Bash",
  ok: o.ok ?? true,
  failed: !(o.ok ?? true),
  command,
  path: "",
  input: command,
  output: o.output ?? "",
});

export const edit = (path: string, change = "x"): Step => ({
  kind: "tool",
  name: "Edit",
  ok: true,
  failed: false,
  command: "",
  path,
  input: `${path} ${change}`,
  output: "",
});

export const said = (text: string, byPerson = true): Step => ({
  kind: "user",
  text,
  byPerson,
});

export const input = (o: Partial<SessionInput> = {}): SessionInput => ({
  id: "s1",
  name: "A session",
  workspaceId: "w1",
  projectId: "p1",
  skip: null,
  brief: "Refactor the parser module",
  final: "Done. The parser is split in two files.",
  steps: [],
  reviews: [],
  inRepo: true,
  run: null,
  previousRun: null,
  recentBriefs: [],
  ...o,
});

// Sends a build to testers: external CLIs, a report of facts, no repo.
export const releaseToTesters = (): SessionInput =>
  input({
    brief: "Send the latest build to the beta testers",
    final:
      "Build 57 (1.4.2) sent to 3 testers. Invite id 6a1f2c9d, group Beta.",
    inRepo: false,
    steps: [
      said("Send the latest build to the beta testers"),
      bash("asc builds list --app 123"),
      bash("cd app && eas submit --platform ios"),
    ],
  });
