import { createHash, randomBytes } from "crypto";
import os from "os";

export function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// 32 random bytes → 43 characters, inside RFC 7636's 43–128.
export function createVerifier(): string {
  return base64url(randomBytes(32));
}

export function createState(): string {
  return base64url(randomBytes(24));
}

export function challengeFor(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}

export const CALLBACK_PATH = "/api/lumifyhub/callback";

export function callbackUrl(origin: string): string {
  return new URL(CALLBACK_PATH, origin).toString();
}

export function clientName(hostname = os.hostname()): string {
  return `AgentOS on ${hostname.replace(/\.local$/, "")}`;
}

export function authorizeUrl(opts: {
  baseUrl: string;
  redirectUri: string;
  state: string;
  challenge: string;
  clientName: string;
}): string {
  const url = new URL("/connect/agentos", opts.baseUrl);
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("state", opts.state);
  url.searchParams.set("code_challenge", opts.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("client_name", opts.clientName);
  return url.toString();
}
