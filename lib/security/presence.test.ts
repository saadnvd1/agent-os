import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import {
  assertionOptions,
  mintEnrollCode,
  PresenceError,
  registrationOptions,
  relyingParty,
  verifyPresence,
} from "./presence";
import { softAuthenticator } from "./soft-authenticator";
import { resetPasskeys, revokePasskey } from "./passkeys";
import { resetRefusal } from "./passkeys-reset";

describe("agent-os passkeys reset", () => {
  it("refuses inside an AgentOS session, an agent's shell, or without a terminal", () => {
    expect(resetRefusal({ AGENTOS_SESSION_ID: "s1" }, true)).toMatch(
      /inside an AgentOS session/
    );
    expect(resetRefusal({ CLAUDECODE: "1" }, true)).toMatch(/agent's shell/);
    expect(resetRefusal({}, false)).toMatch(/interactive terminal/);
    expect(resetRefusal({}, true)).toBeNull();
  });
});

const headers = (origin: string | null, host: string) =>
  new Headers({ host, ...(origin ? { origin } : {}) });
const LOCAL = relyingParty(headers("http://localhost:3011", "localhost:3011"));

beforeEach(() => {
  getDb().exec(
    `DELETE FROM passkeys; DELETE FROM presence_challenges; DELETE FROM passkey_enrollments;
     DELETE FROM settings WHERE key = 'passkeys_bootstrapped_at';`
  );
});

describe("the relying party is the host the page is on", () => {
  it("takes localhost and https hosts, each its own RP ID", () => {
    expect(LOCAL).toEqual({
      rpID: "localhost",
      origin: "http://localhost:3011",
    });
    const tailnet = "saads-macbook-pro.taila1a5b9.ts.net";
    expect(
      relyingParty(headers(`https://${tailnet}:3443`, `${tailnet}:3443`))
    ).toEqual({ rpID: tailnet, origin: `https://${tailnet}:3443` });
  });

  it("refuses plain http off localhost, a foreign origin, or none", () => {
    expect(() =>
      relyingParty(headers("http://mac.ts.net:3011", "mac.ts.net:3011"))
    ).toThrow(/https or localhost/);
    expect(() =>
      relyingParty(headers("https://evil.example", "localhost:3011"))
    ).toThrow(/doesn't match/);
    expect(() => relyingParty(headers(null, "localhost:3011"))).toThrow();
  });
});

describe("an assertion proves presence for exactly one thing", () => {
  async function challenge(binding = "ask:1:abc") {
    const options = await assertionOptions(LOCAL, "approve", binding);
    return options!.challenge;
  }

  it("is accepted once, with user verification, for its binding", async () => {
    const key = softAuthenticator();
    key.register();
    const c = await challenge();
    const assertion = key.assert(c);
    await expect(
      verifyPresence(LOCAL, assertion, "approve", "ask:1:abc")
    ).resolves.toMatchObject({ id: key.id });
    // Single use.
    await expect(
      verifyPresence(LOCAL, assertion, "approve", "ask:1:abc")
    ).rejects.toThrow(/already used/);
  });

  it("won't carry over to another ask, commit or purpose", async () => {
    const key = softAuthenticator();
    key.register();
    const c = await challenge("ask:1:abc");
    await expect(
      verifyPresence(LOCAL, key.assert(c), "approve", "ask:1:def")
    ).rejects.toThrow(PresenceError);
    await expect(
      verifyPresence(LOCAL, key.assert(c), "resume", "ask:1:abc")
    ).rejects.toThrow(PresenceError);
  });

  it("needs user verification, an unexpired challenge, and a known key", async () => {
    const key = softAuthenticator();
    key.register();
    await expect(
      verifyPresence(
        LOCAL,
        key.assert(await challenge(), { verified: false }),
        "approve",
        "ask:1:abc"
      )
    ).rejects.toThrow(PresenceError);
    const c = await challenge();
    getDb().prepare(`UPDATE presence_challenges SET expires_at = 0`).run();
    await expect(
      verifyPresence(LOCAL, key.assert(c), "approve", "ask:1:abc")
    ).rejects.toThrow(/expired/);
    const stranger = softAuthenticator();
    await expect(
      verifyPresence(
        LOCAL,
        stranger.assert(await challenge()),
        "approve",
        "ask:1:abc"
      )
    ).rejects.toThrow(/Unknown passkey/);
    await expect(
      verifyPresence(LOCAL, null, "approve", "ask:1:abc")
    ).rejects.toThrow(/needs your passkey/);
  });

  it("has no options on a host with no passkey", async () => {
    expect(await assertionOptions(LOCAL, "approve", "x")).toBeNull();
  });
});

describe("adding a passkey", () => {
  it("never re-opens trust-on-first-use once used, even with none left", async () => {
    const key = softAuthenticator();
    key.register();
    revokePasskey(key.id);
    await expect(registrationOptions(LOCAL)).rejects.toThrow(
      /needs a code.*agent-os passkeys reset/
    );
    // Only the reset a person runs opens it again.
    resetPasskeys();
    await expect(registrationOptions(LOCAL)).resolves.toHaveProperty(
      "challenge"
    );
  });

  it("refuses a second passkey without an enrollment code", async () => {
    softAuthenticator().register();
    await expect(registrationOptions(LOCAL)).rejects.toThrow(PresenceError);
    await expect(registrationOptions(LOCAL, "")).rejects.toThrow(PresenceError);
  });

  it("is open for the very first one only, then needs a code", async () => {
    await expect(registrationOptions(LOCAL)).resolves.toHaveProperty(
      "challenge"
    );
    softAuthenticator().register();
    await expect(registrationOptions(LOCAL)).rejects.toThrow(/needs a code/);
    await expect(registrationOptions(LOCAL, "NOPE")).rejects.toThrow(
      /needs a code/
    );
    await expect(
      registrationOptions(LOCAL, mintEnrollCode())
    ).resolves.toHaveProperty("challenge");
  });
});
