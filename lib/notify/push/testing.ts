// Test fixtures for the push sender: paired phones with push tokens.

import crypto from "crypto";
import { db } from "../../db";
import { mintDevice, setDevicePush } from "@/lib/security/devices";
import type { PushCategory } from "../push-types";

export function pairPhone(categories?: PushCategory[]): string {
  const { device } = mintDevice("phone");
  setDevicePush(device.id, {
    token: crypto.randomBytes(32).toString("hex"),
    platform: "ios",
    environment: "production",
    categories,
  });
  return device.id;
}

export function resetPush(): void {
  db.prepare(`DELETE FROM push_outbox`).run();
  db.prepare(`DELETE FROM devices`).run();
  const g = globalThis as { __agentosPush?: { dispose(): void } };
  g.__agentosPush?.dispose();
  g.__agentosPush = undefined;
}

export const outboxRows = (where = "1=1") =>
  db
    .prepare(`SELECT * FROM push_outbox WHERE ${where} ORDER BY id`)
    .all() as import("./outbox").OutboxRow[];
