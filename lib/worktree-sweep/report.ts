/**
 * The list a dry run writes before anything is removed: what would go, what
 * stays and why, with sizes, for a person to read before turning the full
 * clean-up on. One file per day under ~/.agent-os/audits/disk-cleanup.
 */

import fs from "fs";
import path from "path";
import { agentosHome } from "../agentos-home";
import type { SweepKind, SweepRemoved, SweepSummary } from "./types";

export const mb = (b: number) =>
  b >= 1024 ** 3
    ? `${(b / 1024 ** 3).toFixed(2)} GB`
    : `${(b / 1024 ** 2).toFixed(1)} MB`;

const TITLES: Record<SweepKind, string> = {
  settled: "Worktrees of finished tasks",
  orphan: "Worktree folders no session owns",
  "test-leak": "Throwaway repositories left by tests",
  database: "Task databases",
  spare: "Dependency spares",
  temp: "Temp folders",
  "derived-data": "Xcode build folders of removed worktrees",
};

function section(kind: SweepKind, items: SweepRemoved[]): string {
  const bytes = items.reduce((n, i) => n + i.bytes, 0);
  const rows = items
    .sort((a, b) => b.bytes - a.bytes)
    .map((i) => `- \`${i.path}\` · ${mb(i.bytes)} · ${i.why}`);
  return `## ${TITLES[kind]}: ${items.length} (${mb(bytes)})\n\n${rows.join("\n")}\n`;
}

export function renderDiskReport(summary: SweepSummary, at: Date): string {
  const all = [...summary.removed, ...(summary.pending ?? [])];
  const kinds = Object.keys(TITLES) as SweepKind[];
  const total = all.reduce((n, i) => n + i.bytes, 0);
  const why = new Map<string, number>();
  for (const k of summary.skipped) {
    const r = k.reason.replace(/\(.*\)/, "").trim();
    why.set(r, (why.get(r) ?? 0) + 1);
  }
  return [
    `# Disk clean-up dry run, ${at.toISOString()}`,
    "",
    `Would remove ${all.length} items, ${mb(total)}. Nothing was removed.`,
    `Full clean-up is ${summary.armed ? "on" : "off"} on this machine.`,
    "",
    ...kinds
      .map((k) => all.filter((i) => i.kind === k))
      .filter((items) => items.length)
      .map((items) => section(items[0].kind, items)),
    `## Kept: ${summary.skipped.length}`,
    "",
    ...[...why].map(([r, n]) => `- ${n} × ${r}`),
    "",
    "### Kept, in detail",
    "",
    ...summary.skipped
      .filter((s) => !/less than \d+ day/.test(s.reason))
      .slice(0, 300)
      .map((s) => `- \`${s.path}\` · ${s.reason}`),
    "",
  ].join("\n");
}

// A second dry run the same day gets -2, -3, never overwrites the first.
export function writeDiskReport(
  summary: SweepSummary,
  at = new Date(),
  dir = agentosHome("audits", "disk-cleanup")
): string {
  fs.mkdirSync(dir, { recursive: true });
  const day = [
    at.getFullYear(),
    String(at.getMonth() + 1).padStart(2, "0"),
    String(at.getDate()).padStart(2, "0"),
  ].join("-");
  let file = path.join(dir, `${day}.md`);
  for (let n = 2; fs.existsSync(file); n++)
    file = path.join(dir, `${day}-${n}.md`);
  fs.writeFileSync(file, renderDiskReport(summary, at), { mode: 0o600 });
  return file;
}
