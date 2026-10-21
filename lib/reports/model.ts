// The model's part of a report: word what the evidence shows. It has no field
// for an estimate, a percentage or a count of finished work; the server
// computes those (estimate.ts) and checks every claim (validate.ts).

import os from "os";
import { runClaude, type ClaudeRunner } from "../orchestrator/claude-cli";
import { untrusted, UNTRUSTED_RULE } from "../orchestrator/untrusted";
import type { RunUsage } from "../usage/check-runs";
import type { AcceptanceItem } from "./estimate";
import type { EvidenceRef } from "./types";
import { MAX_PROMPT } from "./validate";

export const REPORT_TIMEOUT_MS = 60_000;
const PACK_CHARS = 12_000;

const SYSTEM = `You write a short plain-English progress report on one software task for someone who does not read code. You are given numbered evidence items (CI checks, test runs, the review, changed files, acceptance items). Rules:
- Every line must cite the ids of the evidence it rests on, copied exactly. A line with no evidence is thrown away.
- Say only what the evidence shows. Use plain words: no file paths, no jargon, no stack traces.
- Never write a percentage, a completion estimate or a count of finished work: the system works those out. Any number you write must appear in the evidence you cite.
- Tones: "done" for something that passed or happened, "warn" for something failing or still running, "blocked" for something waiting on a person, "next" for what should happen next. A "done" line must cite a passing item; a "warn" or "blocked" line must cite a failing, pending or waiting item.
- "acceptance": for each numbered acceptance item that the evidence proves, give its number and the ids that prove it (a passing test, CI check or review at the latest push; a changed file alone proves nothing). Leave out items you cannot prove.
- "recommendation": one short paragraph on the single best next step, citing evidence.
- "nextPrompt": when work should go on, the exact message to send the coding agent, written as an instruction to it (no more than a few sentences); otherwise null.
${UNTRUSTED_RULE}`;

export const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "lines", "recommendation", "acceptance", "nextPrompt"],
  properties: {
    headline: { type: "string" },
    lines: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["tone", "text", "evidence"],
        properties: {
          tone: { enum: ["done", "warn", "blocked", "next"] },
          text: { type: "string" },
          evidence: { type: "array", items: { type: "string" } },
        },
      },
    },
    recommendation: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["text", "evidence"],
      properties: {
        text: { type: "string" },
        evidence: { type: "array", items: { type: "string" } },
      },
    },
    acceptance: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["item", "evidence"],
        properties: {
          item: { type: "integer" },
          evidence: { type: "array", items: { type: "string" } },
        },
      },
    },
    nextPrompt: { type: ["string", "null"], maxLength: MAX_PROMPT },
  },
} as const;

export function evidencePack(
  task: { name: string; prompt: string },
  state: string,
  evidence: EvidenceRef[],
  items: AcceptanceItem[]
): string {
  const rows = evidence.map(
    (e) =>
      `${e.id} | ${e.kind} | ${e.status} | ${e.label}${
        e.excerpt ? `\n${untrusted(`evidence ${e.id}`, e.excerpt)}` : ""
      }`
  );
  const accept = items.map((it, i) => `${i + 1}. ${it.label}`);
  const body = [
    `Task: ${task.name}`,
    `Brief: ${untrusted("task brief", task.prompt.slice(0, 1200))}`,
    `State: ${state}`,
    accept.length ? `Acceptance items:\n${accept.join("\n")}` : "",
    `Evidence (id | kind | status | label):\n${rows.join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return body.slice(0, PACK_CHARS);
}

export async function askModel(
  input: {
    prompt: string;
    workspaceId: string | null;
    onUsage: (u: RunUsage) => void;
  },
  runner: ClaudeRunner = runClaude
): Promise<unknown> {
  return runner({
    cwd: os.tmpdir(),
    system: SYSTEM,
    prompt: input.prompt,
    schema: SCHEMA,
    tools: [],
    timeoutMs: REPORT_TIMEOUT_MS,
    role: "analyze",
    workspaceId: input.workspaceId,
    onUsage: input.onUsage,
  });
}
