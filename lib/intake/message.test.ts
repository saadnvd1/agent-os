import { describe, expect, it } from "vitest";
import { buildIntakeMessage, type IntakeMeta } from "./message";

const log = Array.from({ length: 200 }, (_, i) =>
  i % 3 === 0
    ? `[${i}] ERROR something went wrong at step ${i} ${"x".repeat(200)}`
    : i % 3 === 1
      ? `[${i}] warn slow ${"y".repeat(100)}`
      : `[${i}] info fine`
).join("\n");

const meta: IntakeMeta = {
  clientId: "client-00000001",
  kind: "report",
  note: "chip overlaps the reconnecting banner",
  report: {
    app: { version: "1.1.0", build: "42" },
    os: "26.0",
    model: "iPhone 15 Pro",
    appearance: "dark",
    screen: {
      route: "/session/[id]",
      session: "fix-composer",
      workspace: "agentos",
      sheet: "none",
    },
    feed: { scrollY: 1240, contentHeight: 3020, atEnd: false, keyboard: false },
    socket: "reconnecting",
  },
};

const files = ["/d/screenshot.jpg", "/d/report.json", "/d/logs.txt"];

describe("buildIntakeMessage", () => {
  it("keeps a report under 1.5 KB with a full log, showing only a few errors", () => {
    const { text } = buildIntakeMessage({
      meta,
      deviceName: "iPhone",
      dir: "/d",
      files,
      logs: log,
    });
    expect(Buffer.byteLength(text)).toBeLessThan(1500);
    expect(text).toContain("Bug report from iPhone (AgentOS 1.1.0 build 42");
    expect(text).toContain("/d/report.json");
    expect(text).toContain("/d/screenshot.jpg");
    expect(
      text.split("\n").filter((l) => l.startsWith("Last errors"))
    ).toHaveLength(1);
    expect((text.match(/ERROR|warn/g) ?? []).length).toBeLessThanOrEqual(5);
  });

  it("stays under the cap even with huge fields", () => {
    const big = "z".repeat(5000);
    const { text } = buildIntakeMessage({
      meta: {
        ...meta,
        report: {
          ...meta.report,
          screen: { route: big, session: big, workspace: big, sheet: big },
          errors: Array.from({ length: 20 }, () => ({ ago: 1, text: big })),
        },
      },
      deviceName: big,
      dir: "/d",
      files,
      logs: log,
    });
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(1500);
  });

  it("frames a share as untrusted, with the excerpt capped at 2 KB", () => {
    const { text, body } = buildIntakeMessage({
      meta: {
        clientId: "client-00000002",
        kind: "share",
        note: "read this",
        share: {
          sourceApp: "Safari",
          url: "https://e.com",
          title: "T",
          text: "é".repeat(5000),
        },
      },
      deviceName: "iPhone",
      dir: "/d",
      files: ["/d/a.png"],
    });
    expect(text).toMatch(/Shared from Safari/);
    expect(text).toContain("<untrusted>");
    expect(text).toContain('Note: "read this"');
    expect(Buffer.byteLength(text)).toBeLessThan(2400);
    expect(body).toBe("Shared from Safari: T");
  });
});
