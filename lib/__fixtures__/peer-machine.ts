import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { rawPublic, type BoxKey, type Identity } from "../peer/keys";

/** A Connect machine's keys, for tests: never on disk unless asked. */
export interface FakeMachine extends Identity {
  box: BoxKey;
  hostname: string;
}

export function fakeMachine(machineId: string): FakeMachine {
  const sign = crypto.generateKeyPairSync("ed25519");
  const box = crypto.generateKeyPairSync("x25519");
  return {
    machineId,
    signKey: sign.privateKey,
    signPub: rawPublic(sign.publicKey),
    box: { privateKey: box.privateKey, publicRaw: rawPublic(box.publicKey) },
    hostname: `m-${crypto.randomBytes(8).toString("hex")}.runagentos.com`,
  };
}

/** Writes the machine's Connect folder (connect.json, machine.key, peer.key). */
export function writeConnectDir(m: FakeMachine): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aos-peer-connect-"));
  fs.writeFileSync(
    path.join(dir, "connect.json"),
    JSON.stringify({
      machineId: m.machineId,
      hostname: m.hostname,
      apiUrl: "https://connect.example.test",
    })
  );
  fs.writeFileSync(
    path.join(dir, "machine.key"),
    m.signKey.export({ format: "pem", type: "pkcs8" })
  );
  fs.writeFileSync(
    path.join(dir, "peer.key"),
    m.box.privateKey.export({ format: "pem", type: "pkcs8" })
  );
  return dir;
}
