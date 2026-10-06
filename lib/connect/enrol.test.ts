import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { enrol, newMachineId } from "./enrol";

describe("enrol", () => {
  it("creates owner-only keys once, and a CSR for the machine's own name", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "connect-enrol-"));
    const first = await enrol({
      domain: "on.test",
      relayUrl: "wss://relay.test",
      dir,
    });
    expect(first.config.machineId).toMatch(/^[a-z0-9]{8}$/);
    expect(first.config.hostname).toBe(`${first.config.machineId}.on.test`);
    for (const f of ["machine.key", "tls.key", "connect.json"]) {
      expect(fs.statSync(path.join(dir, f)).mode & 0o777).toBe(0o600);
    }
    const csr = first.csr.toString();
    expect(csr).toContain("BEGIN CERTIFICATE REQUEST");

    const again = await enrol({
      domain: "on.test",
      relayUrl: "wss://relay.test",
      dir,
    });
    expect(again.config.machineId).toBe(first.config.machineId);
    expect(again.machinePublicKey).toBe(first.machinePublicKey);
  });

  it("tightens the folder and keys every run, not only on create", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "connect-enrol-"));
    await enrol({ domain: "on.test", relayUrl: "wss://r", dir });
    fs.chmodSync(dir, 0o755);
    fs.chmodSync(path.join(dir, "machine.key"), 0o644);
    fs.chmodSync(path.join(dir, "tls.key"), 0o644);
    await enrol({ domain: "on.test", relayUrl: "wss://r", dir });
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    for (const f of ["machine.key", "tls.key"])
      expect(fs.statSync(path.join(dir, f)).mode & 0o777).toBe(0o600);
  });

  it("saves the service's answer before anything that can fail, so a rerun resumes", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "connect-enrol-"));
    // A tls.key that isn't a key makes the CSR step throw after register.
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "tls.key"), "garbage");
    let calls = 0;
    const register = async () => {
      calls++;
      return {
        machineId: "k7q2mz9x",
        hostname: "k7q2mz9x.on.test",
        relayUrl: "wss://r",
      };
    };
    await expect(
      enrol({ domain: "on.test", relayUrl: "x", dir, register })
    ).rejects.toThrow();
    expect(
      JSON.parse(fs.readFileSync(path.join(dir, "connect.json"), "utf8"))
    ).toMatchObject({ machineId: "k7q2mz9x" });
    fs.rmSync(path.join(dir, "tls.key"));
    const { config } = await enrol({
      domain: "on.test",
      relayUrl: "x",
      dir,
      register,
    });
    expect(config.machineId).toBe("k7q2mz9x");
    expect(calls).toBe(1);
  });

  it("makes 8-character lowercase ids", () => {
    const ids = new Set(Array.from({ length: 200 }, newMachineId));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]{8}$/);
  });
});
