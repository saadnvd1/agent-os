// The one alert a sustained red load raises: to the phone, and to each
// workspace orchestrator so it can tell its tasks to back off.
import { sendMessage } from "../bus";
import { notifyPhone } from "../notify";
import { listOrchestrators } from "../orchestrator/home";
import type { LoadView } from "./monitor";

const gb = (bytes: number) => `${(bytes / 2 ** 30).toFixed(1)} GB`;

export function alertText(view: LoadView): string {
  const memory =
    view.pressure && view.pressure !== "normal"
      ? `, memory ${view.pressure}`
      : "";
  const top = view.top.slice(0, 3).map((s) => {
    const heavy = s.heavy.length
      ? ` (${[...new Set(s.heavy)].join(", ")})`
      : "";
    return `${s.name} ${s.cores.toFixed(1)} cores, ${gb(s.rssBytes)}${heavy}`;
  });
  return [
    `Machine load red for 2+ minutes: ${view.load1} on ${view.cores} cores${memory}.`,
    top.length ? `Top: ${top.join("; ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

const BACK_OFF =
  "Ask your running tasks to use targeted tests and hold off on full suites, type checks and builds until it clears. Nothing has been stopped.";

export function raiseAlert(text: string): void {
  notifyPhone("load", text);
  for (const orch of listOrchestrators()) {
    if (orch.archived_at) continue;
    sendMessage({
      fromId: null,
      to: orch.id,
      body: `${text} ${BACK_OFF}`,
      fromLabel: "AgentOS load monitor",
      origin: {
        kind: "system",
        label: "Load monitor",
        body: `${text} ${BACK_OFF}`,
      },
    }).catch((err) =>
      console.error(
        `[load] couldn't tell ${orch.name}:`,
        err instanceof Error ? err.message : err
      )
    );
  }
}
