import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, insertSessionRow } from "@/lib/db";
import { saveItem, deleteItems } from "@/lib/chat/store";
import { createProject } from "@/lib/projects";
import type { ChatItem } from "@/lib/chat/events";
import { archiveSession } from "@/lib/done/archive";
import { bash, end, said, user } from "./__fixtures__/items";

vi.mock("../chat/runner", async (orig) => ({
  ...(await orig<typeof import("../chat/runner")>()),
  sendChat: (await import("./__fixtures__/mocks")).fakeSendChat,
}));
vi.mock("../sessions/launch", async (orig) => ({
  ...(await orig<typeof import("../sessions/launch")>()),
  launchSession: (await import("./__fixtures__/mocks")).fakeLaunch,
}));
const { sent, launched } = await import("./__fixtures__/mocks");

const {
  createLink,
  dismissRecommendation,
  endLink,
  getLink,
  linkView,
  sendRecommendation,
  setPaused,
  pushDigest,
  resumeAnalystLinks,
  AnalystError,
} = await import("./index");
const { onTurnEnd } = await import("./onTurnEnd");

const project = createProject({
  name: `p-${Math.random()}`,
  workingDirectory: "/tmp",
});

function session(extra: Record<string, string | number | null> = {}) {
  const id = `s-${Math.random()}`;
  insertSessionRow(db, {
    id,
    name: `coder ${id.slice(2, 6)}`,
    tmux_name: id,
    project_id: project.id,
    working_directory: "/tmp/repo",
    view: "chat",
    ...extra,
  });
  return id;
}

const save = (sessionId: string, items: ChatItem[]) =>
  items.forEach((i) => saveItem(sessionId, i));

async function turn(sessionId: string, items: ChatItem[]) {
  save(sessionId, items);
  const last = items[items.length - 1] as Extract<
    ChatItem,
    { kind: "turn_end" }
  >;
  await onTurnEnd(sessionId, last);
  return last;
}

const reviewBlock = (prompt = "Fix the null check in a.ts and rerun vitest.") =>
  said(
    "It added the check but the test still fails.\n\n```agentos-review\n" +
      JSON.stringify({
        verdict: "continue",
        summary: "Test still fails.",
        issues: [{ severity: "high", title: "Null crash", detail: "a.ts:3" }],
        prompt,
      }) +
      "\n```"
  );

async function paired() {
  const coder = session();
  save(coder, [user("start"), said("ok"), end()]);
  const link = await createLink({ coderSessionId: coder });
  return { coder, link, analyst: link.analystSessionId };
}

beforeEach(() => {
  sent.length = 0;
  launched.length = 0;
});

describe("pairing", () => {
  it("starts the analyst in the coder's folder, crew and role", async () => {
    const { coder, link, analyst } = await paired();
    expect(launched[0]).toMatchObject({
      workingDirectory: "/tmp/repo",
      agentRole: "analyst",
      crewId: coder,
      parentSessionId: coder,
      access: "ask",
      useWorktree: false,
    });
    const row = (id: string) =>
      db
        .prepare(
          `SELECT agent_role, crew_id, system_prompt FROM session_rows WHERE id = ?`
        )
        .get(id) as {
        agent_role: string;
        crew_id: string;
        system_prompt: string | null;
      };
    expect(row(analyst)).toMatchObject({
      agent_role: "analyst",
      crew_id: coder,
    });
    expect(row(analyst).system_prompt).toContain("agentos-review");
    expect(row(coder)).toMatchObject({
      agent_role: "developer",
      crew_id: coder,
    });
    // Reviews from the next turn on: the one before it isn't sent.
    expect(link.reviewedThrough).toBeTruthy();
    expect(sent).toHaveLength(0);
  });

  it("refuses a terminal, remote or orchestrator coder, a chain and a second analyst", async () => {
    const refused = async (id: string, why: RegExp) =>
      expect(createLink({ coderSessionId: id })).rejects.toThrow(why);
    await refused(session({ view: "terminal" }), /chat session/);
    await refused(session({ host_id: "box" }), /this machine/);
    await refused(session({ role: "orchestrator" }), /orchestrator/);
    const { coder, analyst } = await paired();
    await refused(analyst, /analyst itself/);
    await refused(coder, /already has an analyst/);
    await refused("missing", /not found/);
  });

  it("reviews the last turn now when asked", async () => {
    const coder = session();
    save(coder, [
      user("first"),
      said("one"),
      end(),
      user("second"),
      said("two"),
      end(),
    ]);
    const link = await createLink({ coderSessionId: coder, reviewLast: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain("second");
    expect(sent[0].text).not.toContain("first");
    expect(getLink(link.id)!.pendingDigestId).toBe(sent[0].id);
  });
});

describe("digests", () => {
  it("sends each turn once, coalesces while busy, and turns a reply into a card", async () => {
    const { coder, link, analyst } = await paired();
    const end2 = await turn(coder, [
      user("add null check"),
      bash("npx vitest run", { status: "error", output: "1 failed" }),
      end(),
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      sessionId: analyst,
      id: `user-analyst-${link.id}-${end2.id}`,
      origin: { kind: "event", label: "Coding agent", sessionId: coder },
    });
    expect(sent[0].text).toContain("checks FAILED");

    // Ends while the analyst is still on the digest: waits.
    const end3 = await turn(coder, [
      user("also add a test"),
      said("added"),
      end(),
    ]);
    expect(sent).toHaveLength(1);
    // Repeating the same turn end sends nothing new.
    await onTurnEnd(coder, end2 as Extract<ChatItem, { kind: "turn_end" }>);
    expect(sent).toHaveLength(1);

    const reply = reviewBlock();
    await turn(analyst, [reply, end()]);
    const view = linkView(link.id)!;
    expect(view.recommendations[0]).toMatchObject({
      analystItemId: reply.id,
      state: "open",
      verdict: "continue",
      coderThrough: end2.id,
      prompt: "Fix the null check in a.ts and rerun vitest.",
    });
    expect(view.recommendations[0].signals?.failedTools).toBe(1);
    // The coalesced turn goes next, alone.
    expect(sent).toHaveLength(2);
    expect(sent[1].id).toBe(`user-analyst-${link.id}-${end3.id}`);
    expect(sent[1].text).toContain("also add a test");
    expect(sent[1].text).not.toContain("add null check");
    expect(getLink(link.id)!.reviewedThrough).toBe(end2.id);

    // No block: an invalid card that retires the open one.
    await turn(analyst, [said("Looks fine to me."), end()]);
    const [latest, previous] = linkView(link.id)!.recommendations;
    expect(latest.state).toBe("invalid");
    expect(latest.error).toMatch(/no agentos-review block/);
    expect(previous.state).toBe("superseded");
    expect(getLink(link.id)!.reviewedThrough).toBe(end3.id);

    // A message the reader typed to the analyst isn't a digest: no card.
    sent.length = 0;
    await turn(analyst, [user("why?"), said("Because."), end()]);
    expect(linkView(link.id)!.recommendations[0].id).toBe(latest.id);
  });

  it("holds an interrupted turn for the next, and pauses", async () => {
    const { coder, link } = await paired();
    await turn(coder, [user("go"), said("st"), end({ interrupted: true })]);
    expect(sent).toHaveLength(0);
    await turn(coder, [user("go on"), said("done"), end()]);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain("stopped by the user");
    expect(sent[0].text).toContain("go on");

    const other = await paired();
    setPaused(other.link.id, true);
    await turn(other.coder, [user("x"), said("y"), end()]);
    expect(sent).toHaveLength(1);
    // Review now sends even when paused.
    expect(await pushDigest(other.link.id, { force: true })).toBe("sent");
    expect(sent).toHaveLength(2);
    expect(getLink(link.id)!.paused).toBe(false);
  });

  it("sends a pending digest again after a restart, once", async () => {
    const { coder, link, analyst } = await paired();
    await turn(coder, [user("go"), said("done"), end()]);
    expect(sent).toHaveLength(1);
    // Lost on the way: the restart sends it again under the same id.
    deleteItems(analyst);
    await resumeAnalystLinks();
    expect(sent).toHaveLength(2);
    expect(sent[1].id).toBe(sent[0].id);
    expect(sent[1].text).toBe(sent[0].text);
    await resumeAnalystLinks();
    expect(sent.filter((s) => s.sessionId === analyst)).toHaveLength(2);
    expect(getLink(link.id)!.pendingDigestId).toBe(sent[0].id);
  });
});

describe("send, edit and dismiss", () => {
  async function card() {
    const p = await paired();
    await turn(p.coder, [user("go"), said("done"), end()]);
    await turn(p.analyst, [reviewBlock(), end()]);
    sent.length = 0;
    return { ...p, rec: linkView(p.link.id)!.recommendations[0] };
  }

  it("forwards to the coder as the reader's decision, once", async () => {
    const { coder, analyst, link, rec } = await card();
    const out = await sendRecommendation(link.id, rec.id);
    expect(out).toMatchObject({ state: "sent", edited: false });
    expect(sent).toEqual([
      expect.objectContaining({
        sessionId: coder,
        id: `user-analyst-rec-${rec.id}`,
        text: rec.prompt,
        origin: { kind: "decision", label: "Analyst", sessionId: analyst },
      }),
    ]);
    await expect(sendRecommendation(link.id, rec.id)).rejects.toThrow(
      AnalystError
    );
    await expect(sendRecommendation(link.id, rec.id)).rejects.toMatchObject({
      status: 409,
    });
    expect(() => dismissRecommendation(link.id, rec.id)).toThrow(
      /already sent/
    );
    expect(sent).toHaveLength(1);
  });

  it("sends an edit and marks it edited; dismiss closes a card", async () => {
    const a = await card();
    const out = await sendRecommendation(a.link.id, a.rec.id, "Only fix a.ts");
    expect(out).toMatchObject({ edited: true, sentText: "Only fix a.ts" });
    const b = await card();
    expect(dismissRecommendation(b.link.id, b.rec.id).state).toBe("dismissed");
    await expect(sendRecommendation(b.link.id, b.rec.id)).rejects.toMatchObject(
      { status: 409 }
    );
    await expect(sendRecommendation(b.link.id, "nope")).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("ending", () => {
  it("archiving the coder ends the pairing and settles the analyst", async () => {
    const { coder, link, analyst } = await paired();
    archiveSession(coder);
    expect(getLink(link.id)!.endedAt).toBeTruthy();
    const row = db
      .prepare(`SELECT settled_at FROM session_rows WHERE id = ?`)
      .get(analyst) as { settled_at: string | null };
    expect(row.settled_at).toBeTruthy();
    // Ended: the coder's turns go nowhere.
    await turn(coder, [user("x"), said("y"), end()]);
    expect(sent).toHaveLength(0);
  });

  it("ending the analyst leaves the coder, and the coder can pair again", async () => {
    const { coder, link } = await paired();
    endLink(link.id, { endAnalyst: false });
    expect(getLink(link.id)!.endedAt).toBeTruthy();
    const again = await createLink({ coderSessionId: coder });
    expect(again.id).not.toBe(link.id);
  });
});
