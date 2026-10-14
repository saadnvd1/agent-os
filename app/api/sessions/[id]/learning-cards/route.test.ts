import { beforeEach, describe, expect, it } from "vitest";
import { setExperiment } from "@/lib/experiments";
import { clearCards, seedSession } from "@/lib/learning-cards/__fixtures__/db";
import { insertCard } from "@/lib/learning-cards/store";
import { GET } from "./route";

const get = async (id: string) =>
  (
    await (
      await GET(new Request("http://localhost/x"), {
        params: Promise.resolve({ id }),
      })
    ).json()
  ).cards;

beforeEach(() => {
  clearCards();
  setExperiment("learning-cards", true);
});

describe("GET /api/sessions/[id]/learning-cards", () => {
  it("lists pending cards, and none while off", async () => {
    const s = seedSession();
    insertCard({
      sessionId: s.id,
      workspaceId: s.ws.id,
      kind: "lesson",
      destination: "rule",
      payload: { lesson: "x", destination: "rule", pairs: 1 },
    });
    expect(await get(s.id)).toHaveLength(1);
    setExperiment("learning-cards", false);
    expect(await get(s.id)).toEqual([]);
  });
});
