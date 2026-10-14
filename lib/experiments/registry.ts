// Every experiment AgentOS knows about. All are off until someone turns them
// on. To add one: an entry here, `experimentOn(id)` where it does its work,
// and `experimentRun(id, ...)` for any model call it makes.

export type ExperimentStatus = "experimental" | "beta";

export interface Experiment {
  // Kebab-case and stable: it names the setting and keys the usage rows.
  id: string;
  name: string;
  description: string;
  // Who owns it: "sessions", "tasks", "orchestrator"...
  area: string;
  status: ExperimentStatus;
  // It shows suggestions, so an accept rate means something for it.
  suggests?: boolean;
}

export const EXPERIMENTS = [
  {
    id: "learning-cards",
    name: "Learning cards",
    description:
      "When a session ends, suggest saving it as a recipe or keeping a lesson, in the one place it belongs.",
    area: "sessions",
    status: "experimental",
    suggests: true,
  },
] as const satisfies readonly Experiment[];

export type ExperimentId = (typeof EXPERIMENTS)[number]["id"];

export const isExperimentId = (v: unknown): v is ExperimentId =>
  EXPERIMENTS.some((e) => e.id === v);

export const getExperiment = (id: ExperimentId): Experiment =>
  EXPERIMENTS.find((e) => e.id === id)!;
