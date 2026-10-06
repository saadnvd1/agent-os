/**
 * Connecting AgentOS to a LumifyHub account (docs/lumifyhub.md, "Connecting"):
 * an authorization code with PKCE, or a pasted CLI token. The token is stored
 * server-side only; nothing here returns it.
 */

import { db, lumifyhubQueries as q } from "../db";
import { configuredBaseUrl, LumifyHubClient, LumifyHubError } from "./client";
import {
  authorizeUrl,
  callbackUrl,
  challengeFor,
  clientName,
  createState,
  createVerifier,
} from "./pkce";
import type { LumifyHubStatus } from "./types";

export function getStatus(): LumifyHubStatus {
  const c = q.getConnection(db);
  return {
    connected: !!c,
    baseUrl: c?.base_url ?? configuredBaseUrl(),
    user: c ? { id: c.user_id, email: c.user_email, name: c.user_name } : null,
  };
}

// The client for the stored connection, or null when not connected.
export function connectedClient(): LumifyHubClient | null {
  const c = q.getConnection(db);
  return c ? new LumifyHubClient(c.base_url, c.token) : null;
}

export function requireClient(): LumifyHubClient {
  const client = connectedClient();
  if (!client) throw new LumifyHubError("LumifyHub is not connected", 401);
  return client;
}

// Forget the token when LumifyHub refuses it, so the UI shows "not connected".
export function forgetIfDisconnected(error: unknown): void {
  if (error instanceof LumifyHubError && error.disconnected) {
    q.deleteConnection(db);
  }
}

export function startConnect(origin: string): { url: string } {
  const state = createState();
  const verifier = createVerifier();
  const redirectUri = callbackUrl(origin);
  q.createAttempt(db, { state, verifier, redirect_uri: redirectUri });
  return {
    url: authorizeUrl({
      baseUrl: configuredBaseUrl(),
      redirectUri,
      state,
      challenge: challengeFor(verifier),
      clientName: clientName(),
    }),
  };
}

export async function finishConnect(params: {
  code: string | null;
  state: string | null;
  error: string | null;
}): Promise<void> {
  if (!params.state) throw new Error("Missing state");
  const attempt = q.takeAttempt(db, params.state);
  if (!attempt) throw new Error("This connect link expired. Try again.");
  if (params.error) throw new Error(params.error);
  if (!params.code) throw new Error("Missing code");
  const baseUrl = configuredBaseUrl();
  const { token, user } = await new LumifyHubClient(baseUrl, null).exchangeCode(
    {
      code: params.code,
      code_verifier: attempt.verifier,
      redirect_uri: attempt.redirect_uri,
    }
  );
  q.saveConnection(db, {
    base_url: baseUrl,
    token,
    user_id: user.id,
    user_email: user.email,
    user_name: user.name,
  });
}

export async function connectWithToken(raw: string): Promise<LumifyHubStatus> {
  const token = raw.trim();
  if (!/^lhcli_\S+$/.test(token)) {
    throw new Error("That doesn't look like a LumifyHub CLI token (lhcli_...)");
  }
  const baseUrl = configuredBaseUrl();
  let who: { userId: string; email: string };
  try {
    who = await new LumifyHubClient(baseUrl, token).validate();
  } catch (error) {
    if (error instanceof LumifyHubError && error.disconnected) {
      throw new Error("LumifyHub didn't accept that token");
    }
    throw error;
  }
  q.saveConnection(db, {
    base_url: baseUrl,
    token,
    user_id: who.userId,
    user_email: who.email,
    user_name: null,
  });
  return getStatus();
}

// Local only: the token stays valid in LumifyHub until revoked there.
export function disconnect(): void {
  q.deleteConnection(db);
}
