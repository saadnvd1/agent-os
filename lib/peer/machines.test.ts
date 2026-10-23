import { describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { createHost } from "@/lib/hosts";

vi.mock("./account", () => ({
  accountView: async () => ({
    enrolled: true,
    entitlements: null,
    fetchedAt: 0,
    error: null,
    uncheckedSince: null,
    peers: [
      {
        id: "m-origin",
        name: "origin",
        hostname: "h1",
        lastSeenAt: null,
        version: null,
      },
      {
        id: "m-pc",
        name: "pc",
        hostname: "h2",
        lastSeenAt: null,
        version: null,
      },
      {
        id: "m-new",
        name: "new box",
        hostname: "h3",
        lastSeenAt: null,
        version: null,
      },
    ],
  }),
}));

import { accountMachines } from "./machines";

describe("account machines already linked another way", () => {
  it("counts a Tailscale/ssh link by machine id or by name, not a stranger", async () => {
    const db = getDb();
    const byId = createHost(`ts-${Math.random()}`, "me@ts");
    const byName = createHost("PC", "me@pc");
    for (const h of [byId, byName])
      db.prepare(
        `INSERT INTO host_links (host_id, url, token) VALUES (?, 'http://x', 't')`
      ).run(h.id);
    db.prepare(
      `INSERT INTO host_info (host_id, name, connect_machine_id, addresses, fetched_at) VALUES (?, 'origin', 'm-origin', '[]', 1)`
    ).run(byId.id);

    const { machines } = await accountMachines();
    const get = (id: string) => machines.find((m) => m.id === id)!;
    expect(get("m-origin")).toMatchObject({
      linkState: "active",
      linkedVia: "tailscale",
      hostId: byId.id,
    });
    expect(get("m-pc")).toMatchObject({
      linkState: "active",
      linkedVia: "tailscale",
      hostId: byName.id,
    });
    expect(get("m-new")).toMatchObject({ linkState: null, linkedVia: null });
  });
});
