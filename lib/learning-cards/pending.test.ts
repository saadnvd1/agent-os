import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { setExperiment } from "../experiments";
import { orchestratorOverview } from "../orchestrator/overview";
import { readChangeVersions } from "../db/changes";
import { clearCards, seedSession } from "./__fixtures__/db";
import { dismissCard } from "./apply";
import { cardsFor, pendingCards } from "./index";
import { insertCard } from "./store";

const lesson = (s: ReturnType<typeof seedSession>, text: string) =>
  insertCard({
    sessionId: s.id,
    workspaceId: null,
    kind: "lesson",
    destination: "rule",
    payload: { lesson: text, destination: "rule", pairs: 1 },
  })!;

beforeEach(() => {
  clearCards();
  setExperiment("learning-cards", true);
});

describe("pendingCards", () => {
  it("lists pending cards across workspaces, newest first, with the session name", () => {
    const a = seedSession();
    const b = seedSession();
    const first = lesson(a, "Run tests first");
    const second = insertCard({
      sessionId: b.id,
      workspaceId: b.ws.id,
      kind: "recipe",
      payload: { signals: [], brief: "Do the thing\nin steps", summary: "" },
    })!;
    db.prepare(`UPDATE learning_cards SET created_at = ? WHERE id = ?`).run(
      first.created_at + 10,
      second.id
    );
    const cards = pendingCards();
    expect(cards.map((c) => c.id)).toEqual([second.id, first.id]);
    expect(cards[0]).toMatchObject({
      sessionId: b.id,
      sessionName: "Beta build",
      workspaceId: b.ws.id,
      kind: "recipe",
      title: "Do the thing",
    });
    // A card without its own workspace resolves through the session.
    expect(cards[1]).toMatchObject({
      workspaceId: a.ws.id,
      title: "Run tests first",
    });
  });

  it("filters by workspace and leaves out decided cards and deleted sessions", () => {
    const a = seedSession();
    const b = seedSession();
    const c = seedSession();
    const ca = lesson(a, "A");
    lesson(b, "B");
    const cc = lesson(c, "C");
    dismissCard(cc.id);
    expect(pendingCards(a.ws.id).map((x) => x.id)).toEqual([ca.id]);
    expect(
      pendingCards()
        .map((x) => x.title)
        .sort()
    ).toEqual(["A", "B"]);
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run(b.id);
    expect(pendingCards().map((x) => x.title)).toEqual(["A"]);
  });

  it("is empty while the experiment is off", () => {
    lesson(seedSession(), "A");
    setExperiment("learning-cards", false);
    expect(pendingCards()).toEqual([]);
    expect(orchestratorOverview().every((o) => o.cards.length === 0)).toBe(
      true
    );
  });

  it("is not seeing the card", () => {
    const s = seedSession();
    const card = lesson(s, "A");
    pendingCards();
    orchestratorOverview();
    expect(
      db
        .prepare(`SELECT shown_at FROM learning_cards WHERE id = ?`)
        .get(card.id)
    ).toEqual({ shown_at: null });
  });
});

describe("a decided card disappears everywhere", () => {
  it("leaves the global list, the overview and the session's own list, and moves the pushed topic", () => {
    const s = seedSession({ orchestrator: true });
    const card = lesson(s, "Keep me");
    const overviewCards = () =>
      orchestratorOverview().find((o) => o.workspaceId === s.ws.id)!.cards;
    expect(pendingCards()).toHaveLength(1);
    expect(overviewCards().map((c) => c.id)).toEqual([card.id]);
    expect(cardsFor(s.id)).toHaveLength(1);
    const before = readChangeVersions(db).get("learning_cards") ?? 0;
    dismissCard(card.id);
    expect(pendingCards()).toEqual([]);
    expect(overviewCards()).toEqual([]);
    expect(cardsFor(s.id)).toEqual([]);
    expect(readChangeVersions(db).get("learning_cards")).toBeGreaterThan(
      before
    );
  });
});
