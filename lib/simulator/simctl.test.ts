import { afterEach, describe, expect, it } from "vitest";
import {
  baseName,
  bootDevice,
  cloneDevice,
  deleteDevice,
  deviceNameFor,
  deviceTypeFor,
  ensureBase,
  instancePrefix,
  listDevices,
  parseDevices,
  setSimctlRunner,
  shutdownDevice,
} from "./simctl";

const calls: string[][] = [];
const fake = (
  answers: Record<string, string> = {},
  failOn?: (args: string[]) => Error | null
) =>
  setSimctlRunner(async (args) => {
    calls.push(args);
    const err = failOn?.(args);
    if (err) throw err;
    return answers[args.slice(0, 2).join(" ")] ?? answers[args[0]] ?? "";
  });

afterEach(() => {
  setSimctlRunner(null);
  calls.length = 0;
});

describe("device names", () => {
  it("carry this instance's prefix and a short session id", () => {
    expect(instancePrefix()).toMatch(/^aos-[0-9a-f]{6}-$/);
    expect(deviceNameFor("12345678-aaaa-bbbb-cccc-dddddddddddd")).toBe(
      `${instancePrefix()}12345678`
    );
  });

  it("differs per database, so instances stay apart", () => {
    const before = process.env.DB_PATH;
    const a = instancePrefix();
    process.env.DB_PATH = "/somewhere/else.db";
    expect(instancePrefix()).not.toBe(a);
    process.env.DB_PATH = before;
  });

  it("turns a model into a device type", () => {
    expect(deviceTypeFor("iPhone 17 Pro")).toBe(
      "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro"
    );
  });
});

describe("parseDevices", () => {
  it("flattens runtimes and drops unavailable devices", () => {
    const json = JSON.stringify({
      devices: {
        "com.apple.CoreSimulator.SimRuntime.iOS-26-5": [
          {
            udid: "A",
            name: "iPhone 17",
            state: "Shutdown",
            isAvailable: true,
          },
          { udid: "B", name: "Old", state: "Shutdown", isAvailable: false },
        ],
        "com.apple.CoreSimulator.SimRuntime.iOS-26-2": [],
      },
    });
    expect(parseDevices(json)).toEqual([
      {
        udid: "A",
        name: "iPhone 17",
        state: "Shutdown",
        runtime: "com.apple.CoreSimulator.SimRuntime.iOS-26-5",
      },
    ]);
  });
});

describe("destructive calls", () => {
  it("never touch a device without this instance's prefix", async () => {
    fake();
    await deleteDevice({ udid: "X", name: "agentos-main-e97444" });
    await shutdownDevice({ udid: "X", name: "aos-ffffff-12345678" });
    await expect(
      cloneDevice({ udid: "B", name: "b", state: "", runtime: "" }, "mine")
    ).rejects.toThrow(/refusing/);
    expect(calls).toEqual([]);
  });

  it("shuts down then deletes one of its own", async () => {
    fake();
    await deleteDevice({ udid: "U", name: deviceNameFor("abcdef12-0000") });
    expect(calls).toEqual([
      ["shutdown", "U"],
      ["delete", "U"],
    ]);
  });

  it("treats shutting down a shut-down device as done", async () => {
    fake({}, (a) =>
      a[0] === "shutdown"
        ? new Error("Unable to shutdown device in current state: Shutdown")
        : null
    );
    await expect(
      shutdownDevice({ udid: "U", name: `${instancePrefix()}x` })
    ).resolves.toBeUndefined();
  });

  it("treats booting a booted device as done, then waits for it", async () => {
    fake({}, (a) =>
      a[0] === "boot"
        ? new Error("Unable to boot device in current state: Booted")
        : null
    );
    await bootDevice("U");
    expect(calls.at(-1)).toEqual(["bootstatus", "U", "-b"]);
  });
});

describe("ensureBase", () => {
  const runtimes = JSON.stringify({
    runtimes: [
      { identifier: "rt-26-2", name: "iOS 26.2", isAvailable: true },
      { identifier: "rt-26-5", name: "iOS 26.5", isAvailable: true },
      { identifier: "rt-watch", name: "watchOS 12", isAvailable: true },
    ],
  });

  it("creates the base on the newest iOS, boots it once, shuts it down", async () => {
    fake({
      "list runtimes": runtimes,
      "list devices": JSON.stringify({ devices: {} }),
      create: "NEWUDID",
    });
    const base = await ensureBase("iPhone 17");
    expect(base.udid).toBe("NEWUDID");
    expect(calls.filter((c) => c[0] === "create")).toEqual([
      [
        "create",
        baseName(),
        "com.apple.CoreSimulator.SimDeviceType.iPhone-17",
        "rt-26-5",
      ],
    ]);
    const verbs = calls.map((c) => c[0]);
    expect(verbs.slice(-3)).toEqual(["boot", "bootstatus", "shutdown"]);
  });

  it("reuses a base already on the newest runtime", async () => {
    fake({
      "list runtimes": runtimes,
      "list devices": JSON.stringify({
        devices: {
          "rt-26-5": [{ udid: "OLD", name: baseName(), state: "Shutdown" }],
        },
      }),
    });
    expect((await ensureBase("iPhone 17")).udid).toBe("OLD");
    expect(calls.some((c) => c[0] === "create")).toBe(false);
  });

  it("lists through simctl", async () => {
    fake({ "list devices": JSON.stringify({ devices: {} }) });
    expect(await listDevices()).toEqual([]);
  });
});
