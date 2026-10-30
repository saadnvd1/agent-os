/**
 * Drive: the one guest holding the wheel on a Drive share can start a turn.
 * Everything is decided here, on this machine, on every prompt: Connect only
 * relays, and nothing it sends can give the wheel, change the level or
 * answer an approval. What such a turn may do without the host's tap is the
 * worker's guest gate (lib/chat/worker/guest-gate).
 */

import os from "os";
import path from "path";
import { randomBytes } from "crypto";
import type { Session } from "../db";
import { getSession, registry } from "../chat/registry";
import { chatRefusal } from "../chat/hold";
import { listQueue } from "../chat/queued";
import { hasItem } from "../chat/store";
import type { ChatServerMessage } from "../chat/events";
import {
  GATE_MISSING,
  deleteQueuedChat,
  releaseGuestChat,
  sendGuestPrompt,
  stopGuestTurn,
} from "../chat/runner";
import { getProject } from "../projects";
import { cleanBody } from "./clean";
import { admittedGuestIds, hasDrivePrompt, logLive, wheelOf } from "./store";
import {
  live,
  type DrivePrompt,
  type DriveState,
  type Runtime,
} from "./runtime";
import type { DriverState } from "./types";

export const DRIVE_MAX_CHARS = 4000;
export const DRIVE_EVERY_MS = 15_000;
export const DRIVE_PER_HOUR = 40;
// How long a prompt may be missing from the queue, unstarted, before it
// counts as removed by the host (the worker takes it off just before it
// starts it).
const REMOVED_AFTER_MS = 3000;

export type StopReason =
  "downgraded" | "taken_back" | "kicked" | "left" | "ended";

const STOPPED: Record<StopReason, string> = {
  downgraded: "You can now only watch",
  taken_back: "The host took back control",
  kicked: "You were removed",
  left: "You left",
  ended: "The session ended",
};

export interface DriveFx {
  send: (
    shareId: string,
    action: string,
    data?: Record<string, unknown>
  ) => void;
}

const home = (p: string) => path.resolve(p.replace(/^~(?=$|\/)/, os.homedir()));

/**
 * Why guests can't drive this session, or null. Only a task's own chat,
 * in its own worktree, run by Claude on this machine.
 */
export function driveRefusal(s: Session): string | null {
  if (s.view !== "chat" || s.agent_type !== "claude")
    return "Claude chat sessions only";
  if (s.role) return "Not for an orchestrator";
  if (!s.task_prompt) return "Task sessions only";
  if (!s.worktree_path) return "Task sessions with their own worktree only";
  const project = s.project_id ? getProject(s.project_id) : undefined;
  const wt = home(s.worktree_path);
  if (home(s.working_directory) !== wt)
    return "Task sessions with their own worktree only";
  if (project && home(project.working_directory) === wt)
    return "Not in the project's main checkout";
  if (s.archived_at || s.peer_mirror) return "Not for this session";
  if (s.task_status && s.task_status !== "running")
    return "Only while the task is running";
  return chatRefusal(s.id) ? "Not while the task is moving" : null;
}

export function newDrive(shareId: string): DriveState {
  return { wheel: wheelOf(shareId), prompts: [], accepted: [], epoch: 0 };
}

const sessionOf = (rt: Runtime): Session | null => {
  try {
    return getSession(rt.share.session_id);
  } catch {
    return null;
  }
};

// Whether this guest may drive this share right now (not the rate caps).
function eligibility(rt: Runtime, guestId: string): string | null {
  if (live.runtimes.get(rt.share.id) !== rt || rt.share.ended_at)
    return "This live link has ended";
  if (rt.share.level !== "drive") return "Drive is off for this session";
  const g = rt.guests.get(guestId);
  if (
    rt.drive.wheel?.guestId !== guestId ||
    g?.status !== "admitted" ||
    !admittedGuestIds(rt.share.id).has(guestId)
  )
    return "You're not driving this session";
  const s = sessionOf(rt);
  if (!s) return "This session is gone";
  if (driveRefusal(s)) return "This session can't be driven";
  const w = registry.live.get(s.id);
  if (w && !w.canGuestGate) return GATE_MISSING;
  return null;
}

function limits(rt: Runtime, now: number): string | null {
  const d = rt.drive;
  if (d.prompts.some((p) => p.status !== "running"))
    return "Your last prompt hasn't started yet";
  if (d.prompts.length >= 2) return "Your last prompt hasn't finished yet";
  d.accepted = d.accepted.filter((t) => now - t < 3600_000);
  if (d.accepted.some((t) => now - t < DRIVE_EVERY_MS))
    return "Wait a few seconds between prompts";
  if (d.accepted.length >= DRIVE_PER_HOUR)
    return `You've reached the limit of ${DRIVE_PER_HOUR} prompts an hour`;
  return null;
}

const msgId = (promptId: string) => `guest-${promptId}`;

// The agent reads it as a stranger's request; the chat shows only the text.
export function framed(name: string, text: string): string {
  const who = name.replace(/["\[\]\n]/g, "");
  return `[Live guest "${who}", not the owner of this machine, asks:]\n${text}`;
}

function status(
  rt: Runtime,
  fx: DriveFx,
  p: { id: string; guestId: string },
  s: "running" | "done" | "stopped" | "refused",
  reason?: string
) {
  fx.send(rt.share.id, "drive_status", {
    guest_id: p.guestId,
    id: p.id,
    status: s,
    ...(reason && { reason }),
  });
}

/** A drive_prompt from Connect. Returns false when it was dropped as bogus. */
export function acceptPrompt(
  rt: Runtime,
  frame: { id: string; guest: { id: string }; text: string },
  fx: DriveFx,
  now = Date.now()
): boolean {
  const guestId = frame.guest.id;
  const p0 = { id: frame.id, guestId };
  if (
    rt.drive.prompts.some((p) => p.id === frame.id) ||
    hasDrivePrompt(rt.share.id, frame.id)
  )
    return false;
  const why = eligibility(rt, guestId) ?? limits(rt, now);
  if (why) return (status(rt, fx, p0, "refused", why), true);
  const text = cleanBody(frame.text);
  if (!text || [...text].length > DRIVE_MAX_CHARS) {
    status(
      rt,
      fx,
      p0,
      "refused",
      `A prompt is 1 to ${DRIVE_MAX_CHARS} characters`
    );
    return true;
  }
  const name = rt.guests.get(guestId)!.name;
  const wheel = rt.drive.wheel!.wheel;
  const epoch = rt.drive.epoch;
  logLive({
    share_id: rt.share.id,
    kind: "drive_prompt",
    guest_id: guestId,
    guest_name: name,
    ref: frame.id,
    text,
    sent_text: null,
  });
  rt.drive.accepted.push(now);
  const p: DrivePrompt & { cancelled?: boolean } = { ...p0, status: "sending" };
  rt.drive.prompts.push(p);
  const forget = () => {
    rt.drive.prompts = rt.drive.prompts.filter((x) => x !== p);
  };
  void sendGuestPrompt(
    rt.share.session_id,
    {
      id: msgId(frame.id),
      text: framed(name, text),
      origin: {
        kind: "guest-drive",
        label: name,
        body: text,
        share: rt.share.id,
        guestId,
        wheel,
      },
    },
    // Again right before the worker gets it: a Drive that ended meanwhile
    // (or this prompt stopped) sends nothing.
    () =>
      p.cancelled
        ? "You stopped it"
        : rt.drive.epoch !== epoch || rt.drive.wheel?.wheel !== wheel
          ? "Drive ended"
          : eligibility(rt, guestId)
  )
    .then((refused) => {
      if (refused) {
        if (!rt.drive.prompts.includes(p)) return;
        forget();
        status(rt, fx, p, p.cancelled ? "stopped" : "refused", refused);
      } else if (p.status === "sending") p.status = "queued";
    })
    .catch((e: Error) => {
      if (!rt.drive.prompts.includes(p)) return;
      forget();
      status(rt, fx, p, "refused", e.message.slice(0, 100) || "Not sent");
    });
  return true;
}

/** drive_stop: the wheel holder stops their own prompt, never another's. */
export function stopPrompt(
  rt: Runtime,
  frame: { id: string; guest: { id: string } },
  fx: DriveFx
): boolean {
  const w = rt.drive.wheel;
  if (!w || w.guestId !== frame.guest.id) return false;
  const p = rt.drive.prompts.find(
    (x) => x.id === frame.id && x.guestId === frame.guest.id
  ) as (DrivePrompt & { cancelled?: boolean }) | undefined;
  if (!p) return true;
  if (p.status === "running") {
    p.stopWhy = "You stopped it";
    stopGuestTurn(rt.share.session_id, rt.share.id, w.wheel);
    return true;
  }
  p.cancelled = true;
  if (p.status === "queued") {
    deleteQueuedChat(rt.share.session_id, msgId(p.id));
    rt.drive.prompts = rt.drive.prompts.filter((x) => x !== p);
    status(rt, fx, p, "stopped", "You stopped it");
  }
  return true;
}

/**
 * Gives the wheel (or takes it back, with null). In order, before anything
 * can interleave: the new holder is set and logged, so a racing prompt is
 * refused; then the old holder's Drive is released.
 */
export function setWheel(
  rt: Runtime,
  guestId: string | null,
  reason: StopReason,
  fx: DriveFx
): void {
  const old = rt.drive.wheel;
  if (old?.guestId === guestId && guestId) return;
  const next = guestId
    ? { guestId, wheel: randomBytes(9).toString("base64url") }
    : null;
  rt.drive.wheel = next;
  if (old || next)
    logLive({
      share_id: rt.share.id,
      kind: "wheel",
      guest_id: guestId,
      guest_name: guestId ? (rt.guests.get(guestId)?.name ?? null) : null,
      ref: next?.wheel ?? null,
      text: null,
      sent_text: null,
    });
  releaseDrive(rt, reason, fx, old?.wheel ?? "");
}

/**
 * Ends what a Drive left: queued prompts go (here and in the worker), a
 * turn it steers stops (its pending cards expire as denied), and the guest
 * is told. Synchronous: nothing from that wheel is taken in after it.
 */
export function releaseDrive(
  rt: Runtime,
  reason: StopReason,
  fx: DriveFx,
  wheel = rt.drive.wheel?.wheel ?? ""
): void {
  rt.drive.epoch++;
  if (wheel && rt.drive.wheel?.wheel === wheel) rt.drive.wheel = null;
  const prompts = rt.drive.prompts.splice(0);
  if (!wheel && !prompts.length) return;
  releaseGuestChat(rt.share.session_id, rt.share.id, wheel);
  for (const p of prompts)
    status(
      rt,
      fx,
      p,
      p.status === "running" ? "stopped" : "refused",
      STOPPED[reason]
    );
  logLive({
    share_id: rt.share.id,
    kind: "drive_stopped",
    guest_id: prompts[0]?.guestId ?? null,
    guest_name: null,
    ref: reason,
    text: null,
    sent_text: null,
  });
}

/** What the driving guest's prompt is doing, for the host's view. */
export function driverState(rt: Runtime): DriverState {
  const ps = rt.drive.prompts;
  if (ps.some((p) => p.status === "running"))
    return registry.live.get(rt.share.session_id)?.state === "waiting"
      ? "waiting_on_host"
      : "working";
  return ps.length ? "queued" : "idle";
}

/** A tap on the session's messages: a Drive prompt starting, ending, removed. */
export function onDriveMessage(
  sessionId: string,
  m: ChatServerMessage,
  fx: DriveFx
): void {
  for (const rt of live.runtimes.values()) {
    if (rt.share.session_id !== sessionId || !rt.drive.prompts.length) continue;
    const running = rt.drive.prompts.find((p) => p.status === "running");
    if (m.type === "item" && m.item.kind === "user") {
      const p = rt.drive.prompts.find((x) => msgId(x.id) === m.item.id);
      if (p && p.status !== "running") {
        p.status = "running";
        status(rt, fx, p, "running");
      }
    } else if (
      m.type === "item" &&
      m.item.kind === "note" &&
      m.item.id.startsWith("note-guest-stop-") &&
      running
    ) {
      running.stopWhy = m.item.text.replace(/^Stopped: /, "").slice(0, 100);
    } else if (
      running &&
      ((m.type === "item" && m.item.kind === "turn_end") ||
        (m.type === "state" && m.state === "idle"))
    ) {
      rt.drive.prompts = rt.drive.prompts.filter((p) => p !== running);
      const interrupted =
        m.type === "item" && m.item.kind === "turn_end" && m.item.interrupted;
      if (running.stopWhy || interrupted)
        status(
          rt,
          fx,
          running,
          "stopped",
          running.stopWhy ?? "The host stopped it"
        );
      else status(rt, fx, running, "done");
    } else if (m.type === "queue") {
      for (const p of rt.drive.prompts)
        if (p.status === "queued" && !m.queue.some((q) => q.id === msgId(p.id)))
          setTimeout(
            () => removedByHost(rt, p, fx),
            REMOVED_AFTER_MS
          ).unref?.();
    }
  }
}

// Gone from the queue and never started: the host deleted it.
function removedByHost(rt: Runtime, p: DrivePrompt, fx: DriveFx) {
  const id = msgId(p.id);
  if (!rt.drive.prompts.includes(p) || p.status !== "queued") return;
  if (listQueue(rt.share.session_id).some((q) => q.id === id)) return;
  if (hasItem(rt.share.session_id, id)) return;
  rt.drive.prompts = rt.drive.prompts.filter((x) => x !== p);
  status(rt, fx, p, "refused", "The host removed it");
}
