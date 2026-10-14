import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  readUsage,
  unknownText,
  windowRefusal,
  type Series,
  type UsageState,
} from "./usage";

const now = 1_800_000_000;
const none = () => null;
const series = (window: number, ...samples: [number, number][]): Series => ({
  window,
  samples,
});

function limitsFile(...samples: [number, number][]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aos-limits-"));
  const file = path.join(dir, "limits.json");
  fs.writeFileSync(file, JSON.stringify({ window: now + 3600, samples }));
  return file;
}
const missing = path.join(os.tmpdir(), "aos-no-such-limits.json");
const time = (sec: number) =>
  new Date(sec * 1000).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

describe("readUsage merges AgentOS's readings with the statusline's file", () => {
  it("uses AgentOS's own readings when the file is missing", () => {
    const u = readUsage(
      missing,
      now,
      () => series(now + 3600, [now - 30, 33]),
      none
    );
    expect(u).toEqual({
      window: { pct: 33, resetsIn: 3600, burnPerMin: null, capsIn: null },
    });
  });

  it("uses the file when it was sampled after the store", () => {
    const file = limitsFile([now - 20, 50]);
    const u = readUsage(
      file,
      now,
      () => series(now + 7200, [now - 400, 10]),
      none
    );
    expect(u).toMatchObject({ window: { pct: 50, resetsIn: 3600 } });
  });

  it("uses the store when it is newer than the file", () => {
    const file = limitsFile([now - 500, 50]);
    const u = readUsage(
      file,
      now,
      () => series(now + 7200, [now - 10, 12]),
      none
    );
    expect(u).toMatchObject({ window: { pct: 12, resetsIn: 7200 } });
  });

  it("takes the burn rate from one source's samples, not both", () => {
    const file = limitsFile([now - 1230, 40], [now - 60, 60]);
    const u = readUsage(
      file,
      now,
      () => series(now + 10_800, [now - 30, 2]),
      none
    );
    // The store is newer, but its one sample gives no rate.
    expect(u).toMatchObject({ window: { pct: 2, burnPerMin: null } });
    const burning = readUsage(
      missing,
      now,
      () => series(now + 10_800, [now - 1230, 40], [now - 30, 60]),
      none
    );
    expect(burning).toMatchObject({
      window: { pct: 60, burnPerMin: 1, capsIn: 2400 },
    });
  });
});

describe("staleness", () => {
  it("gives no window, but not unknown, at 11 minutes", () => {
    expect(
      readUsage(missing, now, () => series(now + 3600, [now - 660, 20]), none)
    ).toEqual({ window: null });
  });

  it("is unknown past 15 minutes, with the last value seen", () => {
    const sampled = now - 3700;
    const u = readUsage(
      missing,
      now,
      () => series(now + 3600, [sampled, 61.7]),
      () => null
    );
    expect(u).toEqual({
      unknown: `No agent has run since ${time(sampled)}, so usage isn't sampled`,
      last: { pct: 61, resetsAt: now + 3600, sampledAt: sampled },
    });
  });

  it("is unknown with nothing to show when nothing was ever sampled", () => {
    expect(readUsage(missing, now, none, none)).toEqual({
      unknown:
        "No agent has reported the usage window yet, so usage isn't sampled",
      last: null,
    });
  });

  it("survives a store that throws", () => {
    const boom = () => {
      throw new Error("no db");
    };
    expect(readUsage(limitsFile([now - 5, 9]), now, boom, boom)).toMatchObject({
      window: { pct: 9 },
    });
  });
});

describe("the unknown text", () => {
  it("says no agent has run when nothing ran after the sample", () => {
    expect(unknownText(now - 7200, (now - 7300) * 1000, now)).toBe(
      `No agent has run since ${time(now - 7200)}, so usage isn't sampled`
    );
    expect(unknownText(now - 7200, null, now)).toMatch(
      /^No agent has run since/
    );
  });

  it("adds the date when the sample is from another day", () => {
    const old = now - 3 * 86400;
    expect(unknownText(old, null, now)).toMatch(
      /^No agent has run since [A-Z][a-z]{2} \d+, .*(AM|PM), so usage isn't sampled$/
    );
  });

  it("says agents ran without reporting, when they did", () => {
    expect(unknownText(now - 7200, (now - 600) * 1000, now)).toBe(
      `Agents ran at ${time(now - 600)} but didn't report the usage window; it was last sampled at ${time(now - 7200)}`
    );
  });
});

describe("windowRefusal on an unknown window", () => {
  const unknown = (pct: number, resetsAt: number | null): UsageState => ({
    unknown: "No agent has run since 7:58 PM, so usage isn't sampled",
    last: { pct, resetsAt, sampledAt: now - 7200 },
  });

  it("refuses with the text when there is no last value", () => {
    expect(windowRefusal({ unknown: "why" }, now)).toBe("why");
    expect(windowRefusal({ unknown: "why", last: null }, now)).toBe("why");
  });

  it("allows a low last value, and one whose window has reset", () => {
    expect(windowRefusal(unknown(40, now + 600), now)).toBeNull();
    expect(windowRefusal(unknown(99, now - 1), now)).toBeNull();
  });

  it("refuses a last value near the cap while its window is open", () => {
    expect(windowRefusal(unknown(92, now + 600), now)).toMatch(
      /^No agent has run since 7:58 PM.*; it was 92% used when last seen and resets at /
    );
  });
});
