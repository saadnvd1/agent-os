import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { recordTurn } from "./turns";

const totals = (costUsd: number, inputTokens: number) => ({
  costUsd,
  inputTokens,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});

function session() {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory) VALUES (?, 'chat', ?, '/tmp')`
    )
    .run(id, `claude-${id}`);
  return { id, name: "chat", workspace_id: null };
}

const turns = (id: string) =>
  getDb()
    .prepare(
      `SELECT cost_usd, input_tokens FROM chat_turns WHERE session_id = ? ORDER BY id`
    )
    .all(id);

describe("recordTurn", () => {
  it("writes nothing for a turn that spent nothing (/context)", () => {
    const s = session();
    recordTurn(s, totals(0.5, 100));
    recordTurn(s, totals(0.5, 100));
    expect(turns(s.id)).toEqual([{ cost_usd: 0.5, input_tokens: 100 }]);
  });

  it("counts all of a turn after the totals start again", () => {
    const s = session();
    recordTurn(s, totals(2, 1000));
    recordTurn(s, totals(0.25, 40));
    expect(turns(s.id)).toEqual([
      { cost_usd: 2, input_tokens: 1000 },
      { cost_usd: 0.25, input_tokens: 40 },
    ]);
  });
});
