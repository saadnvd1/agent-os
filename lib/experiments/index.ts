import { getSetting, putSetting } from "../settings-store";
import { type ExperimentId } from "./registry";

type Env = Record<string, string | undefined>;

const key = (id: ExperimentId) => `experiments.${id}`;

// AGENTOS_EXPERIMENTS=off pins every experiment off, like the update banner.
export const experimentsLocked = (env: Env = process.env) =>
  env.AGENTOS_EXPERIMENTS === "off";

// The one check, on the server. Off by default: no row means off.
export function experimentOn(id: ExperimentId, env: Env = process.env) {
  if (experimentsLocked(env)) return false;
  return getSetting(key(id)) === "1";
}

export const setExperiment = (id: ExperimentId, on: boolean) =>
  putSetting(key(id), on ? "1" : null);
