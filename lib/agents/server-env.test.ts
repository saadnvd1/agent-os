import { describe, expect, it } from "vitest";
import { sessionBaseEnv, SERVER_ONLY_ENV } from "./server-env";
import { agentEnv } from "./launch";

describe("sessionBaseEnv", () => {
  const parent = {
    NODE_ENV: "production",
    PORT: "3011",
    AGENTOS_SERVER: "live",
    AGENTOS_DEV: "1",
    AGENTOS_URL: "http://127.0.0.1:3011",
    AGENTOS_PORT: "3011",
    AGENTOS_SESSION_ID: "s1",
    HOME: "/h",
  } as unknown as NodeJS.ProcessEnv;

  it("drops every server-only variable and keeps the rest", () => {
    const env = sessionBaseEnv(parent);
    for (const k of SERVER_ONLY_ENV) expect(env).not.toHaveProperty(k);
    expect(Object.keys(env).sort()).toEqual([
      "AGENTOS_PORT",
      "AGENTOS_SESSION_ID",
      "AGENTOS_URL",
      "HOME",
    ]);
  });

  it("does not touch the parent", () => {
    sessionBaseEnv(parent);
    expect(parent.NODE_ENV).toBe("production");
  });

  it("agentEnv never carries them but has what sessions need", () => {
    const env = agentEnv("abc");
    for (const k of SERVER_ONLY_ENV) expect(env).not.toHaveProperty(k);
    expect(env.AGENTOS_SESSION_ID).toBe("abc");
    expect(env.AGENTOS_URL).toMatch(/^http:/);
  });
});
