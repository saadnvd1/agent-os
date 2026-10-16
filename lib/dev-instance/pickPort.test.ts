import { describe, expect, it } from "vitest";
import { pickPort } from "./pickPort";

const free = async () => true;
const live = { pid: 1, port: 3500, cwd: "/x", startedAt: 0 };

describe("pickPort", () => {
  it("never picks the default, the live, or the session-claimed port", async () => {
    const seen: number[] = [];
    const port = await pickPort({
      env: { AGENTOS_PORT: "3100", AGENTOS_URL: "http://127.0.0.1:3101" },
      live,
      isFree: async (p) => {
        seen.push(p);
        return p >= 3500 ? p !== 3500 : p === 3102;
      },
    });
    expect(port).toBe(3102);
    expect(seen).not.toContain(3100);
    expect(seen).not.toContain(3101);
  });

  it("skips the live port even when PORT is set to it", async () => {
    const port = await pickPort({
      env: { PORT: "3500" },
      live,
      isFree: free,
    });
    expect(port).not.toBe(3500);
    expect(port).not.toBe(3011);
  });

  it("refuses an explicit live or default port", async () => {
    await expect(
      pickPort({ requested: 3500, env: {}, live, isFree: free })
    ).rejects.toThrow(/live/);
    await expect(
      pickPort({ requested: 3011, env: {}, live: null, isFree: free })
    ).rejects.toThrow(/live/);
  });

  it("uses the session's PORT when it is allowed and free", async () => {
    expect(await pickPort({ env: { PORT: "3102" }, live, isFree: free })).toBe(
      3102
    );
  });
});
