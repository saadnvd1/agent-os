import type { ToolItem } from "./group";

const EDGE = 4096;

// A short label for how a command ended, read from its output: the last HTTP
// status line (a redirect chain reports where it landed) or an exit code.
export function toolCode(output?: string): string | undefined {
  if (!output) return undefined;
  const text =
    output.length > EDGE * 2
      ? `${output.slice(0, EDGE)}\n${output.slice(-EDGE)}`
      : output;
  const http = [...text.matchAll(/^HTTP\/[\d.]+ (\d{3})/gm)].pop();
  if (http) return `HTTP ${http[1]}`;
  const exit = [
    ...text.matchAll(
      /(?:^Exit code |Command exited with code |exit (?:code|status)[:= ]+)(\d+)/gim
    ),
  ].pop();
  return exit ? `exit ${exit[1]}` : undefined;
}

export const toolOutcome = (tool: ToolItem): string | undefined =>
  tool.outcome ?? toolCode(tool.output);

export interface StepCounts {
  total: number;
  ok: number;
  failed: number;
  // Never finished: the turn stopped first.
  stopped: number;
  running: number;
}

export function stepCounts(tools: ToolItem[]): StepCounts {
  const n = (s: ToolItem["status"]) =>
    tools.filter((t) => t.status === s).length;
  return {
    total: tools.length,
    ok: n("done"),
    failed: n("error"),
    stopped: n("stopped"),
    running: n("running"),
  };
}
