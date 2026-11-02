import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { seedWorkspace } from "@/lib/orchestrator/testing";
import { TOKEN_HEADER } from "@/lib/orchestrator/tools";
import { addLeads, getLead, standingToken } from "@/lib/leads/home";
import { latestMemo } from "@/lib/leads/memos";
import { POST } from "./route";

const call = (w: string, token: string | null, tool: string, args = {}) =>
  POST(
    new NextRequest(`http://localhost/api/workspaces/${w}/orchestrator/tools`, {
      method: "POST",
      body: JSON.stringify({ tool, args }),
      headers: token ? { [TOKEN_HEADER]: token } : {},
    }),
    { params: Promise.resolve({ id: w }) }
  );

describe("the standing sessions' tools", () => {
  it("knows the caller by its token and keeps Tech's tools Tech's", async () => {
    const { workspace } = seedWorkspace();
    const w = workspace.id;
    const [tech] = addLeads(w, ["marketing"]);
    const marketing = getLead(w, "marketing")!;
    const mine = standingToken(marketing.id);
    expect((await call(w, null, "sessions")).status).toBe(403);
    expect((await call(w, "wrong", "sessions")).status).toBe(403);
    expect((await call(w, mine, "sessions")).status).toBe(200);
    expect((await call(w, mine, "sign_off", { task: "x" })).status).toBe(403);
    expect((await call(w, mine, "nonsense")).status).toBe(400);
    const memo = await call(w, mine, "update_memo", { text: "Mine" });
    expect(memo.status).toBe(200);
    expect(latestMemo(w, "marketing")?.text).toBe("Mine");
    // Tech's token isn't refused sign_off as not its own.
    const techCall = await call(w, standingToken(tech.id), "sign_off", {
      task: "x",
    });
    expect(techCall.status).toBe(400);
    // Another workspace's token is no one here.
    const other = seedWorkspace().workspace.id;
    expect((await call(other, mine, "sessions")).status).toBe(403);
  });
});
