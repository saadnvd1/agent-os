import { describe, expect, it } from "vitest";
import { createHost, hostIdNamed, listHosts, renameHost } from "@/lib/hosts";
import { machineName } from "@/lib/claims/machine";
import { getSetting, putSetting } from "@/lib/settings-store";
import { getDb } from "@/lib/db";

describe("machine names", () => {
  it("lists this machine under its real name, never 'This machine'", () => {
    const me = listHosts()[0];
    expect(me.id).toBe("local");
    expect(me.name).toBe(machineName());
    expect(me.name).not.toBe("This machine");
    expect(me.os).toBeTruthy();
  });

  it("renames this machine through the claims name, and finds it by it", () => {
    const before = getSetting("claims.machine_name");
    try {
      expect(renameHost("local", "  spark   rack-2 ")).toBe("spark rack-2");
      expect(listHosts()[0].name).toBe("spark rack-2");
      expect(hostIdNamed("Spark Rack-2")).toBe("local");
      expect(hostIdNamed("here")).toBe("local");
      expect(() => renameHost("local", "   ")).toThrow(/required/);
    } finally {
      putSetting("claims.machine_name", before);
    }
  });

  it("renames a linked machine, refusing a name already taken", () => {
    const a = createHost(`ren-a-${Math.random()}`, "me@a");
    const b = createHost(`ren-b-${Math.random()}`, "me@b");
    expect(renameHost(a.id, "pc")).toBe("pc");
    expect(() => renameHost(b.id, "PC")).toThrow(/already called/);
    expect(() => renameHost(b.id, machineName())).toThrow(/already called/);
  });

  it("shows what a machine reported about itself", () => {
    const h = createHost(`rep-${Math.random()}`, "me@rep");
    getDb()
      .prepare(
        `INSERT INTO host_info (host_id, name, hostname, os, arch, addresses, fetched_at) VALUES (?, 'x', 'ORIGIN', 'Windows', 'x64', '[]', 1)`
      )
      .run(h.id);
    expect(listHosts().find((x) => x.id === h.id)).toMatchObject({
      hostname: "ORIGIN",
      os: "Windows",
    });
  });
});
