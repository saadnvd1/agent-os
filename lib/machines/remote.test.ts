import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { createHost } from "@/lib/hosts";

const api = vi.hoisted(() => ({ calls: 0, body: null as unknown, fail: "" }));
vi.mock("../hosts/remote-api", async (orig) => ({
  ...(await orig<typeof import("../hosts/remote-api")>()),
  hostLink: (id: string) => ({
    hostId: id,
    hostName: "box",
    url: "",
    token: "",
  }),
  hostApi: async () => {
    api.calls++;
    if (api.fail) throw new Error(api.fail);
    return api.body;
  },
}));

import { fetchHostMachine, hostCatalog, hostInfo, parseReport } from "./remote";

const report = {
  identity: {
    name: "origin",
    hostname: "ORIGIN",
    os: "Windows",
    arch: "x64",
    connectMachineId: "m-1",
    addresses: ["100.64.0.7"],
  },
  catalog: { agents: [], ollama: [] },
};

beforeEach(() => {
  api.calls = 0;
  api.fail = "";
  api.body = report;
  getDb().prepare("DELETE FROM host_info").run();
});

describe("a linked machine's report", () => {
  it("is read once a minute and its identity kept for offline", async () => {
    const host = createHost(`box-${Math.random()}`, "me@box");
    await fetchHostMachine(host.id);
    await fetchHostMachine(host.id);
    expect(api.calls).toBe(1);
    expect(hostInfo(host.id)).toMatchObject({
      name: "origin",
      os: "Windows",
      connectMachineId: "m-1",
      addresses: ["100.64.0.7"],
    });
    api.fail = "down";
    expect(await hostCatalog(host.id)).toMatchObject({
      catalog: expect.anything(),
    });
  });

  it("refuses a body it can't read, and says to update an older AgentOS", async () => {
    const host = createHost(`old-${Math.random()}`, "me@old");
    api.body = { nope: true };
    expect((await hostCatalog(host.id)).error).toMatch(/format/);
    api.fail = "HTTP 404 not allowed";
    const old = createHost(`older-${Math.random()}`, "me@older");
    expect((await hostCatalog(old.id)).error).toMatch(/Update AgentOS/);
  });

  it("trims what a peer sends", () => {
    const r = parseReport({
      ...report,
      identity: {
        ...report.identity,
        name: "x".repeat(500),
        addresses: [1, "a"],
      },
    })!;
    expect(r.identity.name).toHaveLength(60);
    expect(r.identity.addresses).toEqual(["a"]);
    expect(parseReport(null)).toBeNull();
  });
});
