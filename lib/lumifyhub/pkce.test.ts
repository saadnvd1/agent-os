import { describe, it, expect } from "vitest";
import { createHash } from "crypto";
import {
  authorizeUrl,
  base64url,
  callbackUrl,
  challengeFor,
  clientName,
  createState,
  createVerifier,
} from "./pkce";

describe("PKCE", () => {
  it("makes verifiers RFC 7636 allows", () => {
    const v = createVerifier();
    expect(v).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(createVerifier()).not.toBe(v);
    expect(createState()).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("derives the S256 challenge as base64url(sha256(verifier))", () => {
    // RFC 7636, appendix B
    expect(challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
    const digest = createHash("sha256").update("x").digest();
    expect(base64url(digest)).not.toMatch(/[+/=]/);
  });
});

describe("the authorize URL", () => {
  it("carries exactly what the contract names", () => {
    const url = new URL(
      authorizeUrl({
        baseUrl: "https://lumifyhub.io",
        redirectUri: callbackUrl("http://100.73.93.113:3011/"),
        state: "st",
        challenge: "ch",
        clientName: clientName("saads-mac.local"),
      })
    );
    expect(url.origin + url.pathname).toBe(
      "https://lumifyhub.io/connect/agentos"
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      redirect_uri: "http://100.73.93.113:3011/api/lumifyhub/callback",
      state: "st",
      code_challenge: "ch",
      code_challenge_method: "S256",
      client_name: "AgentOS on saads-mac",
    });
  });

  it("respects a base URL with a path-less dev server", () => {
    const url = authorizeUrl({
      baseUrl: "http://localhost:3000",
      redirectUri: "http://localhost:3011/api/lumifyhub/callback",
      state: "s",
      challenge: "c",
      clientName: "AgentOS on x",
    });
    expect(url.startsWith("http://localhost:3000/connect/agentos?")).toBe(true);
    expect(url).toContain("client_name=AgentOS+on+x");
  });
});
