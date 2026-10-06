import { describe, it, expect } from "vitest";
import { EventEmitter } from "events";
import {
  deviceForToken,
  hashToken,
  listDevices,
  mintDevice,
  renameDevice,
  revokeDevice,
  trackDeviceSocket,
} from "./devices";
import { getDb } from "@/lib/db";

describe("devices", () => {
  it("stores only a hash and finds the device by its token", () => {
    const { device, token } = mintDevice("iPhone", "Safari");
    expect(token).toMatch(/^aosd_[A-Za-z0-9_-]{43}$/);
    const row = getDb()
      .prepare(`SELECT token_hash FROM devices WHERE id = ?`)
      .get(device.id) as {
      token_hash: string;
    };
    expect(row.token_hash).toBe(hashToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(deviceForToken(token)).toEqual({ id: device.id });
    expect(deviceForToken("aosd_nope")).toBeNull();
  });

  it("revoking stops the token and closes the device's sockets", () => {
    const { device, token } = mintDevice("iPad");
    const socket = Object.assign(new EventEmitter(), {
      destroyed: false,
      destroy() {
        this.destroyed = true;
      },
    });
    trackDeviceSocket(device.id, socket);
    expect(revokeDevice(device.id)).toBe(true);
    expect(deviceForToken(token)).toBeNull();
    expect(socket.destroyed).toBe(true);
    expect(listDevices().map((d) => d.id)).not.toContain(device.id);
    expect(revokeDevice(device.id)).toBe(false);
  });

  it("renames, refusing blank names", () => {
    const { device } = mintDevice("Laptop");
    expect(renameDevice(device.id, "  ")).toBe(false);
    expect(renameDevice(device.id, "Work laptop")).toBe(true);
    expect(listDevices().find((d) => d.id === device.id)?.name).toBe(
      "Work laptop"
    );
  });
});
