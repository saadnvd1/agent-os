import { describe, expect, it } from "vitest";
import type { ListedDevice } from "@/lib/security/devices";
import { groupDevices } from "./group";

const NOW = Date.parse("2026-11-02T12:00:00Z");
const dev = (id: string, name: string, daysAgo: number, ua = "ua") =>
  ({
    id,
    name,
    user_agent: ua,
    created_at: "2026-01-01 00:00:00",
    last_seen_at: new Date(NOW - daysAgo * 86_400_000)
      .toISOString()
      .slice(0, 19)
      .replace("T", " "),
  }) as unknown as ListedDevice;

describe("groupDevices", () => {
  it("folds identical devices into one group, newest first", () => {
    const sims = Array.from({ length: 40 }, (_, i) =>
      dev(`s${i}`, "Simulator", i / 100)
    );
    const { recent, older } = groupDevices(
      [dev("me", "Laptop", 0, "mac"), ...sims],
      "me",
      NOW
    );
    expect(older).toHaveLength(0);
    expect(recent).toHaveLength(2);
    const group = recent.find((e) => e.kind === "group")!;
    expect(group.kind === "group" && group.devices).toHaveLength(40);
    expect(group.device.id).toBe("s0");
  });

  it("keeps a pair of identical devices as two rows", () => {
    const { recent } = groupDevices(
      [dev("a", "Phone", 1), dev("b", "Phone", 2)],
      null,
      NOW
    );
    expect(recent.map((e) => e.kind)).toEqual(["device", "device"]);
  });

  it("never folds or ages out the device in use", () => {
    const list = [
      dev("me", "Simulator", 90),
      dev("a", "Simulator", 90),
      dev("b", "Simulator", 90),
      dev("c", "Simulator", 90),
    ];
    const { recent, older } = groupDevices(list, "me", NOW);
    expect(recent.map((e) => e.key)).toEqual(["me"]);
    expect(older).toHaveLength(1);
    expect(older[0].kind).toBe("group");
  });

  it("sets devices unused for a month apart", () => {
    const { recent, older } = groupDevices(
      [dev("new", "Phone", 1), dev("old", "iPad", 45)],
      null,
      NOW
    );
    expect(recent.map((e) => e.key)).toEqual(["new"]);
    expect(older.map((e) => e.key)).toEqual(["old"]);
  });
});
