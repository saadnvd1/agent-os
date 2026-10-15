import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { bootsSince, leaveHeartbeat, recentBoots, recordBoot } from "./boots";
import { MIN } from "./types";

const NOW = Date.parse("2026-10-14T18:00:00Z");
beforeEach(() => {
  db.exec(
    `DELETE FROM health_boots; DELETE FROM settings WHERE key = 'health.heartbeat'`
  );
});

describe("boots", () => {
  it("records what the previous run was doing when it was last seen", () => {
    leaveHeartbeat(NOW - MIN, ["aos sim open"]);
    recordBoot(NOW, 123);
    const [b] = recentBoots(1);
    expect(b).toMatchObject({
      started_at: NOW,
      pid: 123,
      prev_seen_at: NOW - MIN,
    });
    expect(JSON.parse(b.prev_bg ?? "[]")).toEqual(["aos sim open"]);
  });
  it("copes with a first ever boot", () => {
    recordBoot(NOW, 1);
    expect(recentBoots(1)[0].prev_seen_at).toBeNull();
  });
  it("lists the boots in a window", () => {
    for (const t of [NOW - 90 * MIN, NOW - 30 * MIN, NOW]) recordBoot(t, 1);
    expect(bootsSince(NOW - 60 * MIN).map((b) => b.started_at)).toEqual([
      NOW - 30 * MIN,
      NOW,
    ]);
  });
});
