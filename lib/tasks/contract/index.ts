/**
 * How a task runs on a linked machine: one client for its API
 * (client.ts), one authorization rule per route (authorize.ts), one loop that
 * keeps mirrors current (sync.ts). Local code paths call these through the
 * entry points they already had (signOff, dropTask, deliver, ...).
 */

export * as taskClient from "./client";
export { TASK_CAPABILITIES, type HostTasks } from "./types";
export {
  isMirror,
  mirrorTask,
  startRemoteTask,
  setMirrorStatus,
} from "./start";
export { mergeThere, dropThere } from "./actions";
export { mirrorViews } from "./views";
export { syncMirrors } from "./sync";
export { taskRoute, refuse, callerRefusal, type Rule } from "./authorize";
export {
  isHeldRemote,
  relayToHeldTask,
  heldChatTail,
  heldChatFacts,
  stopHeldTask,
  doneHeldTask,
  flushUndelivered,
} from "./held-calls";
