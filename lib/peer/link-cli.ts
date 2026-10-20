/**
 * agent-os link: link machines on your AgentOS Connect account from a
 * terminal, for boxes with no browser. Talks to the AgentOS running here
 * over loopback, which counts as this machine (it may accept a code).
 *
 *   agent-os link                     the account's machines and requests waiting here
 *   agent-os link <machine>           start a link; prints the code to type there,
 *                                     then asks for the one it shows back
 *   agent-os link accept <code> [--from <machine>]   prints the code to type back
 *   agent-os link decline [<machine>]
 *   agent-os unlink <machine>
 */

import type { AccountMachines } from "./machines";
import type { PendingView } from "./pairing";
import type { Outgoing } from "./pairing-out";
import { showCode } from "./code";

export interface CliIo {
  base: string;
  fetch: typeof fetch;
  out: (line: string) => void;
  sleep: (ms: number) => Promise<void>;
  /** One line typed in the terminal, or null when there's none to read. */
  ask: (prompt: string) => Promise<string | null>;
}

class CliError extends Error {}

async function call<T>(
  io: CliIo,
  path: string,
  init?: RequestInit
): Promise<T> {
  let res: Response;
  try {
    res = await io.fetch(`${io.base}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    throw new CliError(
      `Can't reach AgentOS at ${io.base}. Is it running? (agent-os status)`
    );
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new CliError(data.error ?? `HTTP ${res.status}`);
  return data;
}

const same = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

function pick<T extends { name: string }>(
  items: T[],
  ref: string | undefined,
  idOf: (t: T) => string,
  what: string
): T {
  if (ref) {
    const hit = items.filter((i) => same(i.name, ref) || idOf(i) === ref);
    if (hit.length === 1) return hit[0];
    throw new CliError(
      hit.length
        ? `More than one ${what} is called ${ref}; use its id.`
        : `No ${what} called ${ref}.`
    );
  }
  if (items.length === 1) return items[0];
  throw new CliError(
    items.length
      ? `Several ${what}s: say which with --from (${items.map((i) => i.name).join(", ")}).`
      : `No ${what} is waiting.`
  );
}

async function list(io: CliIo) {
  const account = await call<AccountMachines>(
    io,
    "/api/peers/account?refresh=1"
  );
  const { requests } = await call<{ requests: PendingView[] }>(
    io,
    "/api/peers/pending"
  );
  if (!account.enrolled) {
    io.out(
      "This machine isn't on AgentOS Connect yet: run agent-os connect first."
    );
    return;
  }
  if (account.entitlements && !account.entitlements.linkMachines)
    io.out("Linking machines needs Pro: upgrade at runagentos.com.\n");
  if (account.error) io.out(`${account.error}\n`);
  if (account.machines.length === 0)
    io.out("No other machines on your account yet.");
  for (const m of account.machines)
    io.out(
      `  ${m.linkState === "active" ? "linked " : m.linkState === "suspended" ? "paused " : "       "} ${m.name}  (${m.online ? "online" : "offline"}, ${m.id})`
    );
  for (const r of requests)
    io.out(
      `\n${r.name} wants to link here: agent-os link accept <the code it shows>`
    );
  if (account.machines.some((m) => !m.linkState))
    io.out("\nLink one with: agent-os link <name>");
}

async function start(io: CliIo, ref: string) {
  const account = await call<AccountMachines>(
    io,
    "/api/peers/account?refresh=1"
  );
  const target = pick(
    account.machines,
    ref,
    (m) => m.id,
    "machine on your account"
  );
  const { link } = await call<{ link: Outgoing }>(io, "/api/peers/link", {
    method: "POST",
    body: JSON.stringify({ machineId: target.id }),
  });
  io.out(
    `\n  Type this code on ${link.name}:\n\n      ${showCode(link.code)}\n`
  );
  io.out(
    `  (its Machines screen, its banner, or agent-os link accept there)\n  Waiting...`
  );
  let state: Outgoing = link;
  while (state.state === "pending") {
    await io.sleep(1500);
    state = (await call<{ link: Outgoing }>(io, `/api/peers/link/${link.id}`))
      .link;
  }
  while (state.state === "confirm") {
    const typed = await io.ask(
      `\n  The code matched on ${state.name}. Type the code it shows now: `
    );
    if (typed === null)
      throw new CliError("No code typed: nothing was linked.");
    const res = await io.fetch(`${io.base}/api/peers/link/${link.id}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: typed }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      link?: Outgoing;
      error?: string;
      attemptsLeft?: number;
    };
    if (data.link) state = data.link;
    else if (data.attemptsLeft)
      io.out(`  ${data.error} ${data.attemptsLeft} left.`);
    else throw new CliError(data.error ?? `HTTP ${res.status}`);
  }
  if (state.state !== "accepted")
    throw new CliError(
      state.state === "expired"
        ? "The code expired. Run agent-os link again."
        : `Not linked (${state.state}${state.error ? `: ${state.error}` : ""}).`
    );
  io.out(`\n  Linked with ${state.name}.\n`);
}

async function answer(io: CliIo, verb: "accept" | "decline", rest: string[]) {
  const i = rest.indexOf("--from");
  const from = i > -1 ? rest[i + 1] : verb === "decline" ? rest[0] : undefined;
  // "482 913" arrives as two words.
  const code =
    verb === "accept"
      ? rest.filter((_, j) => i < 0 || (j !== i && j !== i + 1)).join("")
      : undefined;
  if (verb === "accept" && !code)
    throw new CliError("Usage: agent-os link accept <code> [--from <machine>]");
  const { requests } = await call<{ requests: PendingView[] }>(
    io,
    "/api/peers/pending"
  );
  const req = pick(requests, from, (r) => r.machineId, "link request");
  if (verb === "decline") {
    await call(io, `/api/peers/pending/${req.id}/decline`, { method: "POST" });
    io.out(`Declined ${req.name}.`);
    return;
  }
  const r = await call<{ name: string; confirmCode: string }>(
    io,
    `/api/peers/pending/${req.id}/accept`,
    {
      method: "POST",
      body: JSON.stringify({ code }),
    }
  );
  io.out(
    `Linked with ${r.name}. It can start agents and run code here; unlink with agent-os unlink "${r.name}".`
  );
  io.out(
    `\n  To finish, type this code on ${r.name}:\n\n      ${showCode(r.confirmCode)}\n`
  );
}

async function unlink(io: CliIo, ref: string | undefined) {
  if (!ref) throw new CliError("Usage: agent-os unlink <machine>");
  const { hosts } = await call<{
    hosts: { id: string; name: string; kind?: string }[];
  }>(io, "/api/hosts");
  const host = pick(
    hosts.filter((h) => h.kind === "connect"),
    ref,
    (h) => h.id,
    "linked machine"
  );
  await call(io, `/api/hosts/${host.id}`, { method: "DELETE" });
  io.out(
    `Unlinked ${host.name} here. Remove this machine from its Machines too.`
  );
}

/** Runs one command; returns the exit code. */
export async function runLinkCli(args: string[], io: CliIo): Promise<number> {
  try {
    const [first, ...rest] = args;
    if (first === "--unlink") await unlink(io, rest[0]);
    else if (!first) await list(io);
    else if (first === "accept" || first === "decline")
      await answer(io, first, rest);
    else await start(io, args.join(" "));
    return 0;
  } catch (err) {
    io.out(`  link: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
