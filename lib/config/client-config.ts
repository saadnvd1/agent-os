import { ownerName } from "../owner";
import { ATTACHMENT_LIMITS } from "../attachments/policy";
import { ACCESS_LEVELS, DEFAULT_NEW_CHAT_ACCESS } from "../chat/access-levels";
import { CHAT_ACCESS } from "../chat/events";
import {
  RUN_STATUS_LABELS,
  RUN_TRIGGER_LABELS,
} from "../recipes/status-labels";
import { TASK_STATE_LABELS } from "../tasks/state-labels";
import { forkConfig } from "../fork/options";
import { cachedCheck } from "../updates/check";
import {
  CLIENT_CONFIG_VERSION,
  INTAKE_LIMITS,
  VOICE_LIMITS,
  type ClientFeatures,
  type ClientConfig,
} from "./client-config-types";

const startedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();

// Off when its env switch says so, for a server that wants it dark.
export function featuresNow(): ClientFeatures {
  const intake = process.env.AGENTOS_INTAKE !== "off";
  return {
    shakeToReport: intake,
    shareIntake: intake,
    voice: process.env.AGENTOS_VOICE !== "off",
  };
}

export function clientConfig(): ClientConfig {
  return {
    v: CLIENT_CONFIG_VERSION,
    server: { version: cachedCheck()?.current?.version ?? null, startedAt },
    access: {
      levels: CHAT_ACCESS.map((value) => ({ value, ...ACCESS_LEVELS[value] })),
      default: DEFAULT_NEW_CHAT_ACCESS,
    },
    taskStates: TASK_STATE_LABELS,
    runStatuses: RUN_STATUS_LABELS,
    runTriggers: RUN_TRIGGER_LABELS,
    features: featuresNow(),
    intake: INTAKE_LIMITS,
    attachments: ATTACHMENT_LIMITS,
    voice: VOICE_LIMITS,
    ownerName: ownerName(),
    forks: forkConfig(),
  };
}
