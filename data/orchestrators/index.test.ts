import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AskView,
  OrchestratorOverview,
} from "@/lib/orchestrator/overview";
import { post, withAskBack, withoutAsk } from ".";

const ask = (id: number) => ({ id, title: `ask ${id}` }) as AskView;
const overview = (workspaceId: string, ids: number[]) =>
  ({ workspaceId, asks: ids.map(ask) }) as OrchestratorOverview;
const ids = (list: OrchestratorOverview[] | undefined, w: string) =>
  list?.find((o) => o.workspaceId === w)?.asks.map((a) => a.id);

describe("an answer that wasn't recorded", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("puts only that card back, in its place", () => {
    const list = [overview("w", [1, 2, 3]), overview("x", [9])];
    // 2 was answered and failed; 3 was answered meanwhile and succeeded.
    const answering = withoutAsk(withoutAsk(list, "w", 2), "w", 3);
    expect(ids(answering, "w")).toEqual([1]);
    const back = withAskBack(answering, "w", ask(2));
    expect(ids(back, "w")).toEqual([1, 2]);
    expect(ids(back, "x")).toEqual([9]);
  });

  it("doesn't put back a card that's already there", () => {
    const list = [overview("w", [1, 2])];
    expect(ids(withAskBack(list, "w", ask(2)), "w")).toEqual([1, 2]);
  });

  it("says AgentOS couldn't be reached when the request never got an answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );
    await expect(post("/api/x", {})).rejects.toThrow(
      /Couldn't reach AgentOS, so this may not be saved/
    );
  });

  it("reports a refusal, even one that isn't JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("<html>Bad Gateway</html>", { status: 502 })
      )
    );
    await expect(post("/api/x", {})).rejects.toThrow("Request failed (502)");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: "This ask is already approved" }),
            {
              status: 400,
            }
          )
      )
    );
    await expect(post("/api/x", {})).rejects.toThrow(
      "This ask is already approved"
    );
  });
});
