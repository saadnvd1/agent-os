import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./control-api";
import { startHeartbeat } from "./heartbeat";

const setup = (beat: () => Promise<{ enabled: boolean }>) => {
  const logs: string[] = [];
  const onDisabled = vi.fn();
  const onGone = vi.fn();
  const hb = startHeartbeat({
    beat,
    onDisabled,
    onGone,
    log: (l) => logs.push(l),
  });
  return { hb, logs, onDisabled, onGone };
};
const minute = () => vi.advanceTimersByTimeAsync(60_000);

describe("startHeartbeat", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("beats at start, then once a minute, until stopped", async () => {
    const beat = vi.fn(async () => ({ enabled: true }));
    const { hb } = setup(beat);
    await vi.advanceTimersByTimeAsync(0);
    expect(beat).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(beat).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(beat).toHaveBeenCalledTimes(2);
    await minute();
    expect(beat).toHaveBeenCalledTimes(3);
    hb.stop();
    await minute();
    expect(beat).toHaveBeenCalledTimes(3);
  });

  it("enabled:false stops the tunnel and the beats, logging once", async () => {
    const beat = vi.fn(async () => ({ enabled: false }));
    const { logs, onDisabled } = setup(beat);
    await minute();
    await minute();
    expect(onDisabled).toHaveBeenCalledTimes(1);
    expect(beat).toHaveBeenCalledTimes(1);
    expect(logs).toHaveLength(1);
  });

  it("logs a failure streak once, keeps the pace, and recovers", async () => {
    let fail = true;
    const beat = vi.fn(async () => {
      if (fail) throw new ApiError("boom", 503, {});
      return { enabled: true };
    });
    const { logs, onGone } = setup(beat);
    await minute();
    await minute();
    await minute();
    expect(beat).toHaveBeenCalledTimes(4);
    expect(logs).toHaveLength(1);
    fail = false;
    await minute();
    fail = true;
    await minute();
    expect(logs).toHaveLength(2);
    expect(onGone).not.toHaveBeenCalled();
  });

  it("treats a thrown network error like a 5xx", async () => {
    const beat = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const { logs } = setup(beat);
    await minute();
    expect(beat).toHaveBeenCalledTimes(2);
    expect(logs).toHaveLength(1);
  });

  it.each([401, 404])(
    "a %i stops the heartbeat and says so",
    async (status) => {
      const beat = vi.fn(async () => {
        throw new ApiError("gone", status, {});
      });
      const { logs, onGone, onDisabled } = setup(beat);
      await minute();
      await minute();
      expect(beat).toHaveBeenCalledTimes(1);
      expect(onGone).toHaveBeenCalledTimes(1);
      expect(onDisabled).not.toHaveBeenCalled();
      expect(logs).toEqual([
        "connect: machine no longer linked, run agent-os connect",
      ]);
    }
  );
});
