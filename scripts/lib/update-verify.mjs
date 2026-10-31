// Is the server that just restarted healthy? Used by scripts/update-run.mjs
// after an update's swap and again after a rollback.
//   - /api/updates/health answers with the build we expect and every
//     migration applied (a build from before that route: /api/health only);
//   - a few key routes answer without a server error;
//   - it stays up: the same startedAt across the stability checks, so a
//     crash loop under a service manager's restart doesn't pass.
// Knobs (tests): AGENTOS_VERIFY_UP_MS, AGENTOS_VERIFY_EVERY_MS, AGENTOS_VERIFY_CHECKS.

const SMOKE = ["/api/projects", "/api/sessions", "/api/updates"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(base, path) {
  try {
    const res = await fetch(base + path, {
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } catch {
    return { status: 0, body: null };
  }
}

/** One look: { ok, startedAt } or { ok: false, why }. */
async function health(base, expect) {
  const h = await get(base, "/api/updates/health");
  if (h.status === 404) {
    // An older build, from before this route: alive is all it can say.
    const old = await get(base, "/api/health");
    return old.status === 200 && old.body?.ok
      ? { ok: true, startedAt: old.body.startedAt ?? null }
      : { ok: false, why: `the server didn't answer (${old.status})` };
  }
  if (h.status !== 200 || !h.body?.ok)
    return { ok: false, why: `the server didn't answer (${h.status})` };
  const { build, migrations, startedAt } = h.body;
  if (expect && build && build !== expect && !build.startsWith("v"))
    return {
      ok: false,
      why: `it is running ${String(build).slice(0, 7)}, not ${expect.slice(0, 7)}`,
    };
  if (migrations && migrations.applied < migrations.known)
    return {
      ok: false,
      why: `${migrations.known - migrations.applied} database migration(s) didn't run`,
    };
  return { ok: true, startedAt };
}

/**
 * Resolves { ok: true } or { ok: false, why } within about
 * AGENTOS_VERIFY_UP_MS plus the stability checks.
 */
export async function verifyServer({ port, expect, env = process.env }) {
  const base = `http://127.0.0.1:${port}`;
  const upMs = Number(env.AGENTOS_VERIFY_UP_MS ?? 120_000);
  const every = Number(env.AGENTOS_VERIFY_EVERY_MS ?? 30_000);
  const checks = Number(env.AGENTOS_VERIFY_CHECKS ?? 4);

  let first = null;
  const until = Date.now() + upMs;
  for (;;) {
    first = await health(base, expect);
    if (first.ok || Date.now() >= until) break;
    await sleep(Math.min(2_000, every));
  }
  if (!first.ok) return first;

  for (const path of SMOKE) {
    const r = await get(base, path);
    if (r.status === 0 || r.status >= 500)
      return { ok: false, why: `${path} failed (${r.status || "no answer"})` };
  }

  for (let i = 0; i < checks; i++) {
    await sleep(every);
    const again = await health(base, expect);
    if (!again.ok)
      return { ok: false, why: `it stopped answering: ${again.why}` };
    if (
      first.startedAt &&
      again.startedAt &&
      again.startedAt !== first.startedAt
    )
      return { ok: false, why: "it restarted by itself (a crash loop)" };
  }
  return { ok: true };
}
