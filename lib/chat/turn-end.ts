import type { TurnEndReason } from "./events";

// The ends a Retry button can resume: the model's side failed or went quiet.
const RETRYABLE: TurnEndReason[] = [
  "error",
  "empty",
  "stalled",
  "compaction_empty",
  "cut_off",
];

export const retryableEnd = (reason: TurnEndReason) =>
  RETRYABLE.includes(reason);

// What Retry sends: the steps that ran stay, the model carries on.
export const RETRY_TEXT = "continue";
