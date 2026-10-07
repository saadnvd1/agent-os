/**
 * OSC 7501, the Program Status Protocol: a program reports its own state
 * (idle, working, blocked on you, done, failed) through the pty.
 * Spec: https://www.superlogical.com/rex/docs/build/program-status (0.2)
 *
 *   ESC ] 7501 ; state=blocked:kind=permission:app=x:msg=<base64> ST
 *
 * Everything in a report is untrusted text from whatever runs in the pane.
 * Input is a byte stream read as latin1, so one char is one byte and the
 * spec's byte limits are string lengths.
 */

export type ProgramState = "idle" | "working" | "done" | "blocked" | "error";
export type BlockedKind = "permission" | "question" | "auth";

export interface Report {
  state: ProgramState | "clear";
  // The record's path; "" is the root.
  id: string;
  kind?: BlockedKind;
  app?: string;
  progress?: number;
  msg?: string;
  title?: string;
}

export type OscEvent =
  | { type: "report"; report: Report }
  | { type: "query" }
  // OSC 133 A: a new shell prompt began.
  | { type: "prompt" };

export const LIMITS = {
  sequence: 4096,
  key: 16,
  msgEncoded: 2732,
  msgDecoded: 2048,
  titleEncoded: 256,
  titleDecoded: 192,
  app: 32,
  id: 128,
  idSegment: 32,
  idDepth: 8,
} as const;

const STATES = new Set([
  "idle",
  "working",
  "done",
  "blocked",
  "error",
  "clear",
]);
const KINDS = new Set(["permission", "question", "auth"]);
const KEY = /^[a-z]+$/;
const VALUE = /^[A-Za-z0-9_.,+/=-]*$/;
const SEGMENT = /^[A-Za-z0-9_.+-]{1,32}$/;
const APP = /^[A-Za-z0-9_.+-]{1,32}$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
// C0, DEL and C1.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

// Standard base64 of UTF-8, padding optional. undefined when it isn't valid
// base64 or UTF-8; "refuse" when the text breaks a rule the spec says
// discards the whole report (too long, or a control character).
function decodeText(
  value: string,
  maxDecoded: number
): string | undefined | "refuse" {
  if (!BASE64.test(value)) return undefined;
  const bare = value.replace(/=+$/, "");
  if (bare.length % 4 === 1) return undefined;
  if (value.length !== bare.length && value.length % 4 !== 0) return undefined;
  const bytes = Buffer.from(bare, "base64");
  if (bytes.length > maxDecoded) return "refuse";
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
  return CONTROL.test(text) ? "refuse" : text;
}

/** One report's body (what follows "7501;"), or null when it's discarded. */
export function parseReport(body: string): Report | null {
  const fields = new Map<string, string>();
  for (const pair of body.split(":")) {
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const key = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    if (key.length > LIMITS.key) return null;
    if (!KEY.test(key) || !VALUE.test(value)) continue;
    fields.set(key, value);
  }

  const state = fields.get("state");
  if (!state || !STATES.has(state)) return null;
  const report: Report = { state: state as Report["state"], id: "" };

  const id = fields.get("id");
  if (id !== undefined) {
    const segments = id.split("/");
    if (
      id.length > LIMITS.id ||
      segments.length > LIMITS.idDepth ||
      !segments.every((s) => SEGMENT.test(s))
    )
      return null;
    report.id = id;
  }
  if (report.state === "clear") return report;

  const app = fields.get("app");
  if (app !== undefined) {
    if (app.length > LIMITS.app) return null;
    if (APP.test(app)) report.app = app;
  }

  const kind = fields.get("kind");
  if (report.state === "blocked" && kind && KINDS.has(kind))
    report.kind = kind as BlockedKind;

  const progress = fields.get("progress");
  if (
    (report.state === "working" || report.state === "blocked") &&
    progress !== undefined &&
    /^\d{1,3}$/.test(progress) &&
    Number(progress) <= 100
  )
    report.progress = Number(progress);

  for (const [key, maxEncoded, maxDecoded] of [
    ["msg", LIMITS.msgEncoded, LIMITS.msgDecoded],
    ["title", LIMITS.titleEncoded, LIMITS.titleDecoded],
  ] as const) {
    const value = fields.get(key);
    if (value === undefined) continue;
    if (value.length > maxEncoded) return null;
    const text = decodeText(value, maxDecoded);
    if (text === "refuse") return null;
    if (text) report[key] = text;
  }
  return report;
}

const ESC = "\x1b";
const BEL = "\x07";
const OURS = ["7501;", "133;"];

function couldBeOurs(body: string): boolean {
  return OURS.some((p) =>
    body.length < p.length ? p.startsWith(body) : body.startsWith(p)
  );
}

type End =
  | { kind: "done"; bodyEnd: number; next: number }
  // An ESC that isn't ST cancels the string and starts something else.
  | { kind: "cancelled"; at: number }
  | { kind: "more" };

function findEnd(data: string, from: number): End {
  for (let j = from; j < data.length; j++) {
    const c = data[j];
    if (c === BEL) return { kind: "done", bodyEnd: j, next: j + 1 };
    if (c === ESC) {
      if (j + 1 === data.length) return { kind: "more" };
      return data[j + 1] === "\\"
        ? { kind: "done", bodyEnd: j, next: j + 2 }
        : { kind: "cancelled", at: j };
    }
  }
  return { kind: "more" };
}

function toEvent(body: string): OscEvent | null {
  if (body.startsWith("7501;")) {
    const rest = body.slice(5);
    if (rest === "?") return { type: "query" };
    const report = parseReport(rest);
    return report ? { type: "report", report } : null;
  }
  if (body === "133;A" || body.startsWith("133;A;")) return { type: "prompt" };
  return null;
}

/**
 * Finds OSC 7501 (and OSC 133 A) sequences in a pane's output, which arrives
 * in arbitrary chunks. Holds at most one partial sequence of ours (capped at
 * the spec's 4096 bytes); other strings are skipped without being kept.
 */
export class OscScanner {
  private pending = "";
  private skipping = false;

  push(chunk: string): OscEvent[] {
    const data = this.pending + chunk;
    this.pending = "";
    const events: OscEvent[] = [];
    let pos = 0;
    while (pos < data.length) {
      if (this.skipping) {
        const end = findEnd(data, pos);
        if (end.kind === "more") {
          if (data.endsWith(ESC)) this.pending = ESC;
          return events;
        }
        this.skipping = false;
        pos = end.kind === "done" ? end.next : end.at;
        continue;
      }
      const start = data.indexOf(ESC + "]", pos);
      if (start === -1) {
        if (data.endsWith(ESC)) this.pending = ESC;
        return events;
      }
      const end = findEnd(data, start + 2);
      if (end.kind === "cancelled") {
        pos = end.at;
        continue;
      }
      if (end.kind === "more") {
        const rest = data.slice(start);
        if (rest.length >= LIMITS.sequence || !couldBeOurs(rest.slice(2))) {
          this.skipping = true;
          if (rest.endsWith(ESC)) this.pending = ESC;
        } else {
          this.pending = rest;
        }
        return events;
      }
      if (end.next - start <= LIMITS.sequence) {
        const event = toEvent(data.slice(start + 2, end.bodyEnd));
        if (event) events.push(event);
      }
      pos = end.next;
    }
    return events;
  }
}
