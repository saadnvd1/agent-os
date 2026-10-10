import { describe, expect, it, vi } from "vitest";
import { alertText, raiseAlert } from "./alert";

describe("the load alert", () => {
  it("names the load and the top three sessions with their heavy commands", () => {
    const s = (name: string, cores: number, heavy: string[] = []) => ({
      sessionId: name,
      name,
      cores,
      rssBytes: 2 * 2 ** 30,
      heavy,
    });
    const text = alertText({
      level: "red",
      load1: 42.1,
      cores: 10,
      memUsedPct: 91,
      pressure: "critical",
      top: [
        s("api", 6.2, ["vitest", "vitest"]),
        s("web", 3.1, ["tsc"]),
        s("ios", 1),
        s("docs", 0.5),
      ],
      sessions: {},
    });
    expect(text).toBe(
      "Machine load red for 2+ minutes: 42.1 on 10 cores, memory critical. Top: api 6.2 cores, 2.0 GB (vitest); web 3.1 cores, 2.0 GB (tsc); ios 1.0 cores, 2.0 GB."
    );
  });
});

const sent = vi.hoisted(() => ({
  phone: [] as string[],
  to: [] as string[],
  origins: [] as unknown[],
}));
vi.mock("../notify", () => ({
  notifyPhone: (_source: string, text: string) => sent.phone.push(text),
}));
vi.mock("../bus", () => ({
  sendMessage: async (o: { to: string; origin?: unknown }) => {
    sent.to.push(o.to);
    sent.origins.push(o.origin);
    return {};
  },
}));
vi.mock("../orchestrator/home", () => ({
  listOrchestrators: () => [
    { id: "live", name: "live", archived_at: null },
    { id: "gone", name: "gone", archived_at: "2026-10-01" },
  ],
}));

describe("raising the alert", () => {
  it("goes to the phone and to every orchestrator that isn't archived", () => {
    raiseAlert("Machine load red.");
    expect(sent.phone).toEqual(["Machine load red."]);
    expect(sent.to).toEqual(["live"]);
    // Shown in chat as a notice, not as Saad's message.
    expect(sent.origins[0]).toMatchObject({
      kind: "system",
      label: "Load monitor",
    });
  });
});
