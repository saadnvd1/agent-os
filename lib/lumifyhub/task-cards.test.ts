import { describe, it, expect, vi, beforeEach } from "vitest";
import { db, queries, type Project, type Session } from "../db";
import type { LhList } from "./types";

const client = {
  baseUrl: "https://lh.test",
  listLists: vi.fn(),
  moveCard: vi.fn(),
  addComment: vi.fn(),
  createCard: vi.fn(),
};

vi.mock("./connection", () => ({
  connectedClient: () => client,
  forgetIfDisconnected: () => {},
}));

const { attachTaskCard, syncTaskCard } = await import("./task-cards");

const lists: LhList[] = [
  ["todo", "To Do"],
  ["prog", "In Progress"],
  ["rev", "In Review"],
  ["done", "Done"],
].map(([id, name], position) => ({
  id,
  name,
  position,
  board_id: "board",
  category: "unstarted",
}));

const project = { lh_board_id: "board" } as Project;

function newSession(id: string): Session {
  db.prepare(`INSERT INTO sessions (id, name) VALUES (?, ?)`).run(id, id);
  return queries.getSession(db).get(id) as Session;
}

const listOf = (id: string) =>
  (queries.getSession(db).get(id) as Session).lh_card_list;

beforeEach(() => {
  vi.clearAllMocks();
  client.listLists.mockResolvedValue(lists);
  client.addComment.mockResolvedValue({ id: "c" });
});

describe("task card sync", () => {
  it("applies a merge that lands while the first sync is in flight", async () => {
    let release!: () => void;
    client.moveCard.mockImplementationOnce(
      () => new Promise<void>((r) => (release = r))
    );
    client.moveCard.mockResolvedValue({});
    const session = newSession("t-merge");

    const attached = attachTaskCard(session, project, "card-1");
    await vi.waitFor(() => expect(client.moveCard).toHaveBeenCalledTimes(1));
    const merged = syncTaskCard(session, "merged", null);
    release();
    await Promise.all([attached, merged]);

    expect(client.moveCard.mock.calls.map((c) => c[2])).toEqual([
      "prog",
      "done",
    ]);
    expect(listOf("t-merge")).toBe("done");
  });

  it("comments once when the same outcome arrives twice", async () => {
    client.moveCard.mockResolvedValue({});
    const session = newSession("t-drop");
    await attachTaskCard(session, project, "card-2");
    await Promise.all([
      syncTaskCard(session, "dropped", null),
      syncTaskCard(session, "dropped", null),
    ]);
    expect(client.addComment).toHaveBeenCalledTimes(1);
    expect(listOf("t-drop")).toBe("dropped");
  });
});
