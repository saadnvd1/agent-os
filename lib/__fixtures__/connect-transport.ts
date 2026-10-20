import { createConnectHost } from "../hosts";
import { RPC_PATH, openRequest, sealResponse } from "../peer/envelope";
import { signPublic } from "../peer/keys";
import { savePin } from "../peer/links";
import { createReplayGuard } from "../peer/replay";
import { fakeMachine, writeConnectDir, type FakeMachine } from "./peer-machine";

type Inner = (url: string, init: RequestInit) => Promise<Response>;

/**
 * The other machine's side of the Connect transport, for tests written
 * against the token transport: it opens each envelope as that machine would
 * and hands the inner call to `inner` as a plain `<baseUrl><path>` fetch, so
 * the same mock answers either transport. Anything not a valid envelope to
 * that machine is refused the way rpc-server refuses it; calls to any other
 * machine go to `inner` unchanged.
 */
export function connectFetch(
  inner: Inner,
  o: { peer: FakeMachine; from: FakeMachine; baseUrl: string }
): typeof fetch {
  const replay = createReplayGuard();
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    // Another machine on a token link answers as it always has.
    if (url.hostname !== o.peer.hostname)
      return inner(String(input), init ?? {});
    if (url.pathname !== RPC_PATH) throw new Error(`unexpected fetch ${url}`);
    const opened = openRequest(Buffer.from(init?.body as Uint8Array), {
      self: o.peer.machineId,
      boxKey: o.peer.box.privateKey,
      signKeyFor: (id) =>
        id === o.from.machineId ? signPublic(o.from.signPub) : "unknown_peer",
      replay,
    });
    if (!opened.ok) return new Response(opened.refusal, { status: 401 });
    const r = opened.request;
    const res = await inner(
      `${o.baseUrl}${r.path}${r.query ? `?${r.query}` : ""}`,
      {
        method: r.method,
        headers: r.contentType ? { "Content-Type": r.contentType } : {},
        body: r.body.length ? r.body.toString("utf8") : undefined,
      }
    );
    const sealed = sealResponse({
      resKey: opened.resKey,
      nonce: opened.nonce,
      signKey: o.peer.signKey,
      response: {
        status: res.status,
        contentType: res.headers.get("content-type") ?? "",
        body: Buffer.from(await res.arrayBuffer()),
      },
    });
    return new Response(new Uint8Array(sealed), { status: 200 });
  }) as typeof fetch;
}

/**
 * A machine linked through Connect, named `name`, whose answers come from
 * `inner` as if it were at `baseUrl`. This machine's Connect folder is
 * pointed at a fresh identity.
 */
export function connectLinkedHost(
  name: string,
  inner: Inner,
  baseUrl: string
): {
  hostId: string;
  fetch: typeof fetch;
  /** Every request this machine actually sent, before the peer opened it. */
  sent: { url: string; init: RequestInit }[];
} {
  const self = fakeMachine("aaaa1111");
  const peer = fakeMachine("bbbb2222");
  process.env.AGENTOS_CONNECT_DIR = writeConnectDir(self);
  const hostId = createConnectHost(name).id;
  savePin({
    hostId,
    machineId: peer.machineId,
    hostname: peer.hostname,
    signPub: peer.signPub,
    boxPub: peer.box.publicRaw,
  });
  const sent: { url: string; init: RequestInit }[] = [];
  const answer = connectFetch(inner, { peer, from: self, baseUrl });
  const outer = ((input: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(input), init: init ?? {} });
    return answer(input, init);
  }) as typeof fetch;
  return { hostId, fetch: outer, sent };
}
