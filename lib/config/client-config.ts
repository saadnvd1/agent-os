import { ACCESS_LEVELS, DEFAULT_NEW_CHAT_ACCESS } from "../chat/access-levels";
import { CHAT_ACCESS } from "../chat/events";
import {
  RUN_STATUS_LABELS,
  RUN_TRIGGER_LABELS,
} from "../recipes/status-labels";
import { TASK_STATE_LABELS } from "../tasks/state-labels";
import { cachedCheck } from "../updates/check";
import {
  CLIENT_CONFIG_VERSION,
  type ClientConfig,
} from "./client-config-types";

const startedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();

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
  };
}
