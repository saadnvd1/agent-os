import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import { findOrphans, type SessionRow, type TmuxListing } from "./orphans";

const name = (agent = "claude") => `${agent}-${randomUUID()}`;
const idOf = (n: string) => n.slice(-36);
const row = (
  id: string,
  tmux_name: string | null,
  host_id: string | null = null
): SessionRow => ({
  id,
  tmux_name,
  host_id,
});
const bare = (n: string): TmuxListing => ({ name: n, taggedId: null });
const killed = (listing: TmuxListing[], rows: SessionRow[]) =>
  findOrphans(listing, rows).map((o) => o.name);

describe("findOrphans", () => {
  it("finds an agent session with no row and keeps one with a row", () => {
    const gone = name();
    const kept = name("codex");
    expect(killed([bare(gone), bare(kept)], [row(idOf(kept), kept)])).toEqual([
      gone,
    ]);
  });

  it("finds a chat worker session whose session is gone", () => {
    const id = randomUUID();
    const worker = `aos-chat-${id}`;
    expect(killed([bare(worker)], [row(randomUUID(), "x")])).toEqual([worker]);
    expect(killed([bare(worker)], [row(id, "x")])).toEqual([]);
  });

  it("finds a renamed session by the id AgentOS tagged it with", () => {
    const id = randomUUID();
    const listing = [{ name: "my-feature", taggedId: id }];
    expect(killed(listing, [row(randomUUID(), "other")])).toEqual([
      "my-feature",
    ]);
    expect(killed(listing, [row(id, "my-feature")])).toEqual([]);
  });

  it("keeps a session whose name a row holds even when the id differs", () => {
    const n = name();
    expect(killed([bare(n)], [row(randomUUID(), n)])).toEqual([]);
  });

  it("does not count another machine's row as holding a local name", () => {
    const n = name();
    expect(killed([bare(n)], [row(randomUUID(), n, "host-1")])).toEqual([n]);
  });

  it("never touches sessions AgentOS didn't make", () => {
    const external = [
      "dispatch-roa-26",
      "main",
      "0",
      "claude-notauuid",
      "work",
    ].map(bare);
    expect(killed(external, [row(randomUUID(), "x")])).toEqual([]);
  });

  it("ignores a tag that is not a session id", () => {
    expect(
      killed([{ name: "t", taggedId: "nope" }], [row(randomUUID(), "x")])
    ).toEqual([]);
  });
});
