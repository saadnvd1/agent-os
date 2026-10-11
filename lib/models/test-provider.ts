/**
 * "Test provider": one tiny request to a provider's endpoint with its key,
 * reporting whether it answered. The key goes only into the request's
 * header; what comes back is scrubbed of it before anyone sees it.
 */

import { runClaude, type ClaudeRunner } from "../orchestrator/claude-cli";
import { effectiveModels } from "./config";
import type { ModelProvider } from "./providers";
import { ANTHROPIC } from "./roles";
import { redact, resolveSecret, type SecretCommand } from "./secrets";
import os from "os";

export interface ProviderTest {
  ok: boolean;
  message: string;
  ms: number;
}

const PROMPT = "Reply with the word OK.";

export async function testProvider(
  providerId: string,
  model?: string,
  deps: {
    exec?: SecretCommand;
    fetch?: typeof fetch;
    claude?: ClaudeRunner;
  } = {}
): Promise<ProviderTest> {
  const started = Date.now();
  const done = (ok: boolean, message: string): ProviderTest => ({
    ok,
    message: redact(message).slice(0, 300),
    ms: Date.now() - started,
  });
  const p = effectiveModels().providers.find((x) => x.id === providerId);
  if (!p) return done(false, `No provider "${providerId}"`);
  const m = model || p.tiers?.haiku || p.models[0];
  if (!m) return done(false, "It lists no model to try");
  try {
    if (p.id === ANTHROPIC) {
      await (deps.claude ?? runClaude)({
        cwd: os.tmpdir(),
        system: "Answer in the schema.",
        prompt: PROMPT,
        schema: {
          type: "object",
          properties: { ok: { type: "boolean" } },
          required: ["ok"],
        },
        tools: [],
        model: m,
        timeoutMs: 60_000,
      });
      return done(true, `${m} answered through the Claude login`);
    }
    if (!p.baseUrl || !p.auth) return done(false, "Set its base URL and key");
    const key = await resolveSecret(p.auth, deps.exec);
    const res = await (deps.fetch ?? fetch)(...request(p, m, key));
    // Never followed: a redirect would carry the key somewhere else.
    if (res.status >= 300 && res.status < 400)
      return done(
        false,
        `HTTP ${res.status}: the endpoint redirected; set its final URL`
      );
    if (res.ok) return done(true, `${m} answered (HTTP ${res.status})`);
    const body = (await res.text().catch(() => ""))
      .slice(0, 200)
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");
    return done(false, `HTTP ${res.status}: ${body}`);
  } catch (e) {
    return done(false, e instanceof Error ? e.message : String(e));
  }
}

function request(
  p: ModelProvider,
  model: string,
  key: string
): [string, RequestInit] {
  const base = p.baseUrl!.replace(/\/+$/, "");
  const messages = [{ role: "user", content: PROMPT }];
  const signal = AbortSignal.timeout(30_000);
  const redirect = "manual" as const;
  if (p.api === "openai")
    return [
      `${base}/chat/completions`,
      {
        method: "POST",
        redirect,
        signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ model, max_tokens: 8, messages }),
      },
    ];
  return [
    `${base}/v1/messages`,
    {
      method: "POST",
      redirect,
      signal,
      headers: {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        ...(p.authHeader === "x-api-key"
          ? { "x-api-key": key }
          : { authorization: `Bearer ${key}` }),
      },
      body: JSON.stringify({ model, max_tokens: 8, messages }),
    },
  ];
}
