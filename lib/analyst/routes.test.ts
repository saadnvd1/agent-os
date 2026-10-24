import { describe, expect, it, vi } from "vitest";
import { db, insertSessionRow } from "@/lib/db";
import { saveItem } from "@/lib/chat/store";
import { createProject } from "@/lib/projects";
import { POST as create } from "@/app/api/analyst/route";
import {
  DELETE as unlink,
  GET as get,
  PATCH as patch,
} from "@/app/api/analyst/[id]/route";
import { POST as review } from "@/app/api/analyst/[id]/review/route";
import { POST as send } from "@/app/api/analyst/[id]/recommendations/[recId]/send/route";
import { POST as dismiss } from "@/app/api/analyst/[id]/recommendations/[recId]/dismiss/route";
import { POST as again } from "@/app/api/analyst/[id]/recommendations/[recId]/again/route";
import { GET as ofSession } from "@/app/api/sessions/[id]/analyst/route";
import { onTurnEnd } from "./onTurnEnd";
import { end, said, user } from "./__fixtures__/items";
import type { ChatItem } from "@/lib/chat/events";

vi.mock("../chat/runner", async (orig) => ({
  ...(await orig<typeof import("../chat/runner")>()),
  sendChat: (await import("./__fixtures__/mocks")).fakeSendChat,
}));
vi.mock("../sessions/launch", async (orig) => ({
  ...(await orig<typeof import("../sessions/launch")>()),
  launchSession: (await import("./__fixtures__/mocks")).fakeLaunch,
}));

const req = (body?: unknown, method = "POST") =>
  new Request("http://localhost/x", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = (id: string, recId = "") => ({
  params: Promise.resolve({ id, recId }),
});

const project = createProject({
  name: `p-${Math.random()}`,
  workingDirectory: "/tmp",
});
function coder() {
  const id = `s-${Math.random()}`;
  insertSessionRow(db, {
    id,
    name: id,
    tmux_name: id,
    project_id: project.id,
    view: "chat",
  });
  return id;
}

async function turnEnd(sessionId: string, items: ChatItem[]) {
  items.forEach((i) => saveItem(sessionId, i));
  await onTurnEnd(
    sessionId,
    items[items.length - 1] as Extract<ChatItem, { kind: "turn_end" }>
  );
}

describe("analyst routes", () => {
  it("validates bodies and finds pairings", async () => {
    expect((await create(req({}))).status).toBe(400);
    expect(
      (
        await create(
          req({
            coderSessionId: "a",
            newCoder: { projectId: "p", agentType: "claude" },
          })
        )
      ).status
    ).toBe(400);
    expect((await create(req({ coderSessionId: "missing" }))).status).toBe(404);
    expect((await get(req(undefined, "GET"), ctx("missing"))).status).toBe(404);
    expect(
      (await patch(req({ paused: "yes" }, "PATCH"), ctx("missing"))).status
    ).toBe(400);
    expect((await review(req(), ctx("missing"))).status).toBe(404);
    const bad = new Request("http://localhost/x", {
      method: "POST",
      body: "{nope",
    });
    expect((await create(bad)).status).toBe(400);
  });

  it("starts the analyst on the model picked for it, else on none (its role's)", async () => {
    const { launched } = await import("./__fixtures__/mocks");
    const picked = await create(
      req({ coderSessionId: coder(), analystModel: "ollama/qwen3.8" })
    );
    expect(picked.status).toBe(200);
    expect(launched.at(-1)).toMatchObject({
      agentRole: "analyst",
      model: "ollama/qwen3.8",
    });
    expect((await create(req({ coderSessionId: coder() }))).status).toBe(200);
    expect(launched.at(-1)).toMatchObject({
      agentRole: "analyst",
      model: null,
    });
  });

  it("pairs, pauses, reviews, sends, dismisses and unlinks", async () => {
    const id = coder();
    expect(await (await ofSession(req(), ctx(id))).json()).toEqual({
      link: null,
    });
    expect((await review(req(), ctx("x"))).status).toBe(404);

    const made = await create(req({ coderSessionId: id }));
    expect(made.status).toBe(200);
    const { link } = await made.json();
    expect(link.coder.id).toBe(id);
    expect((await create(req({ coderSessionId: id }))).status).toBe(409);
    const mine = await (await ofSession(req(), ctx(link.analyst.id))).json();
    expect(mine.link.id).toBe(link.id);

    // Nothing finished yet: Review now has nothing to send.
    expect((await review(req(), ctx(link.id))).status).toBe(409);
    const paused = await (
      await patch(req({ paused: true }, "PATCH"), ctx(link.id))
    ).json();
    expect(paused.link.paused).toBe(true);
    await patch(req({ paused: false }, "PATCH"), ctx(link.id));

    await turnEnd(id, [user("go"), said("done"), end()]);
    await turnEnd(link.analyst.id, [
      said(
        '```agentos-review\n{"verdict":"continue","summary":"s","prompt":"next"}\n```'
      ),
      end(),
    ]);
    const { link: withCard } = await (
      await get(req(undefined, "GET"), ctx(link.id))
    ).json();
    const rec = withCard.recommendations[0];
    expect(rec.state).toBe("open");
    expect((await send(req({ text: 5 }), ctx(link.id, rec.id))).status).toBe(
      400
    );
    expect((await again(req(), ctx(link.id, rec.id))).status).toBe(409);
    const out = await send(req({ text: "next, edited" }), ctx(link.id, rec.id));
    expect((await out.json()).recommendation).toMatchObject({
      state: "sent",
      edited: true,
    });
    expect((await send(req(), ctx(link.id, rec.id))).status).toBe(409);
    expect((await dismiss(req(), ctx(link.id, rec.id))).status).toBe(409);
    expect((await dismiss(req(), ctx(link.id, "missing"))).status).toBe(404);

    const ended = await (
      await unlink(req({ endAnalyst: false }, "DELETE"), ctx(link.id))
    ).json();
    expect(ended.link.endedAt).toBeTruthy();
    expect((await review(req(), ctx(link.id))).status).toBe(409);
    expect(await (await ofSession(req(), ctx(id))).json()).toEqual({
      link: null,
    });
  });
});
