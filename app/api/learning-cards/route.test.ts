import { beforeEach, describe, expect, it } from "vitest";
import { setExperiment } from "@/lib/experiments";
import { clearCards, seedSession } from "@/lib/learning-cards/__fixtures__/db";
import { insertCard } from "@/lib/learning-cards/store";
import { GET } from "./route";

beforeEach(() => {
  clearCards();
  setExperiment("learning-cards", true);
});

describe("GET /api/learning-cards", () => {
  it("lists every pending card, and none while the experiment is off", async () => {
    const s = seedSession();
    insertCard({
      sessionId: s.id,
      workspaceId: s.ws.id,
      kind: "lesson",
      destination: "rule",
      payload: { lesson: "Run tests first", destination: "rule", pairs: 1 },
    });
    const on = await (await GET()).json();
    expect(on.cards).toHaveLength(1);
    expect(on.cards[0]).toMatchObject({
      sessionId: s.id,
      title: "Run tests first",
    });
    setExperiment("learning-cards", false);
    expect((await (await GET()).json()).cards).toEqual([]);
  });
});
