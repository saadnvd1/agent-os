import { describe, expect, it } from "vitest";
import type { AskView, QuestionView } from "../orchestrator/ask-view";
import {
  inboxCounts,
  needsYouRows,
  pickTab,
  unreadCount,
  type OverviewLike,
} from "./counts";

const ask = (id: number, subject: string): AskView => ({
  id,
  subject,
  kind: "decision",
  title: `Ask ${id}`,
  why: "",
  detail: "",
  link: null,
  sha: null,
  binding: subject,
  presence: false,
  createdAt: "2026-01-01 10:00:00",
});
const question = (id: number, task: string | null): QuestionView => ({
  id,
  text: `Question ${id}`,
  task,
  taskName: null,
  createdAt: "2026-01-01 11:00:00",
});
const overview = (over: Partial<OverviewLike> = {}): OverviewLike => ({
  workspaceId: "w1",
  asks: [],
  questions: [],
  dismissed: [],
  ...over,
});

describe("inbox counts", () => {
  it("is the sum of its parts", () => {
    const rows = needsYouRows({
      waiting: [{ id: "s1", name: "One" }],
      overviews: [
        overview({ asks: [ask(1, "brake")], questions: [question(2, null)] }),
      ],
    });
    expect(rows.map((r) => r.kind).sort()).toEqual([
      "ask",
      "input",
      "question",
    ]);
    expect(
      inboxCounts({ rows, tasksNeedingYou: ["t1", "t2"], unread: 4 })
    ).toEqual({ needs: 3, tasks: 2, messages: 4, total: 9 });
  });

  it("lists a session that is waiting and the subject of an ask once", () => {
    const rows = needsYouRows({
      waiting: [{ id: "t1", name: "Task one" }],
      overviews: [overview({ asks: [ask(1, "task:t1")] })],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("ask");
    expect(
      inboxCounts({ rows, tasksNeedingYou: ["t1"], unread: 0 }).total
    ).toBe(1);
  });

  it("lets a question about a task replace that task's input row", () => {
    const rows = needsYouRows({
      waiting: [{ id: "t1", name: "Task one" }],
      overviews: [overview({ questions: [question(5, "t1")] })],
    });
    expect(rows.map((r) => r.kind)).toEqual(["question"]);
  });

  it("counts a task needing you once when it is also waiting for input", () => {
    const rows = needsYouRows({
      waiting: [{ id: "t1", name: "Task one" }],
      overviews: [],
    });
    const counts = inboxCounts({
      rows,
      tasksNeedingYou: ["t1", "t2"],
      unread: 0,
    });
    // t1 is already a Needs-you row; its Tasks tab count still shows both.
    expect(counts).toMatchObject({ needs: 1, tasks: 2, total: 2 });
  });

  it("leaves out what he dismissed", () => {
    const rows = needsYouRows({
      waiting: [],
      overviews: [
        overview({
          asks: [ask(1, "brake"), ask(2, "x")],
          dismissed: ["ask:1"],
        }),
      ],
    });
    expect(rows.map((r) => r.key)).toEqual(["ask:2"]);
  });

  it("counts unread messages from his seen mark", () => {
    const msgs = [{ id: 1 }, { id: 2 }, { id: 3 }];
    expect(unreadCount(msgs, null)).toBe(0);
    expect(unreadCount(msgs, 1)).toBe(2);
    expect(unreadCount(msgs, 3)).toBe(0);
  });

  it("opens on Needs you when it has items, else the last tab", () => {
    expect(pickTab({ needs: 2, last: "tasks" })).toBe("needs");
    expect(pickTab({ needs: 0, last: "tasks" })).toBe("tasks");
    expect(pickTab({ needs: 0, last: null })).toBe("needs");
    expect(pickTab({ explicit: "messages", needs: 2, last: "tasks" })).toBe(
      "messages"
    );
  });
});
