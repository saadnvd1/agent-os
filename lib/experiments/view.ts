import { experimentOn, experimentsLocked } from ".";
import { EXPERIMENTS, type Experiment, type ExperimentId } from "./registry";
import { usageSummary, type UsageSummary } from "./meter";

export interface ExperimentView extends Experiment {
  on: boolean;
  usage: UsageSummary;
}

export const experimentView = (id: ExperimentId): ExperimentView => ({
  ...EXPERIMENTS.find((e) => e.id === id)!,
  on: experimentOn(id),
  usage: usageSummary(id),
});

export const experimentsView = () => ({
  locked: experimentsLocked(),
  experiments: EXPERIMENTS.map((e) => experimentView(e.id)),
});
