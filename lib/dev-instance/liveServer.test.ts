import { describe, expect, it } from "vitest";
import {
  isLiveServer,
  liveCheckout,
  readLiveRecord,
  writeLiveRecord,
} from "./liveServer";
import { tempDir } from "@/lib/test-temp";

describe("isLiveServer", () => {
  it("is the marker, or a bare production launch", () => {
    expect(isLiveServer({ AGENTOS_SERVER: "live" })).toBe(true);
    expect(isLiveServer({ NODE_ENV: "production" })).toBe(true);
  });
  it("is not a dev, demo or own-database server", () => {
    expect(
      isLiveServer({ AGENTOS_SERVER: "dev", NODE_ENV: "production" })
    ).toBe(false);
    expect(isLiveServer({ NODE_ENV: "production", DB_PATH: "/x.db" })).toBe(
      false
    );
    expect(isLiveServer({ NODE_ENV: "production", AGENTOS_DEMO: "1" })).toBe(
      false
    );
    expect(isLiveServer({ NODE_ENV: "development" })).toBe(false);
  });
});

describe("live record", () => {
  const home = tempDir("live-");
  it("reads a live pid and ignores a dead one", () => {
    writeLiveRecord(
      { pid: process.pid, port: 3011, cwd: "/x", startedAt: 1 },
      home
    );
    expect(readLiveRecord(home)?.port).toBe(3011);
    writeLiveRecord(
      { pid: 2 ** 22 + 12345, port: 3011, cwd: "/x", startedAt: 1 },
      home
    );
    expect(readLiveRecord(home)).toBeNull();
    // The checkout is still known mid-restart.
    expect(liveCheckout(home)).toBe("/x");
  });
});
