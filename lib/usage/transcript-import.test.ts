import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { importTranscripts } from "./transcript-import";

const line = (id: string, over: Record<string, unknown> = {}, usage = {}) =>
  JSON.stringify({
    type: "assistant",
    timestamp: new Date().toISOString(),
    message: {
      id,
      model: "claude-opus-5-5",
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        cache_read_input_tokens: 5000,
        ...usage,
      },
    },
    ...over,
  }) + "\n";

describe("importTranscripts", () => {
  let root: string;
  let claudeId: string;
  let main: string;
  beforeEach(() => {
    db.exec(
      `DELETE FROM usage_calls; DELETE FROM usage_import_offsets; DELETE FROM sessions;`
    );
    root = fs.mkdtempSync(path.join(os.tmpdir(), "aos-transcripts-"));
    claudeId = randomUUID();
    const id = randomUUID();
    db.prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory, task_status, claude_session_id)
       VALUES (?, 'task', ?, '/tmp', 'running', ?)`
    ).run(id, `claude-${id}`, claudeId);
    const dir = path.join(root, "-tmp-work");
    fs.mkdirSync(path.join(dir, claudeId, "subagents"), { recursive: true });
    main = path.join(dir, `${claudeId}.jsonl`);
    fs.writeFileSync(
      main,
      line("m1") +
        line("m1", {}, { output_tokens: 90 }) +
        "not json\n" +
        JSON.stringify({ type: "user" }) +
        "\n"
    );
    const sub = path.join(dir, claudeId, "subagents", "agent-1.jsonl");
    fs.writeFileSync(sub, line("s1", { isSidechain: true }));
    fs.writeFileSync(
      sub.replace(/\.jsonl$/, ".meta.json"),
      JSON.stringify({ agentType: "review-security" })
    );
  });

  const rows = () =>
    db
      .prepare(
        `SELECT call_key, kind, agent_type, output_tokens, role FROM usage_calls ORDER BY call_key`
      )
      .all();

  it("imports a session's calls once per message id, subagents by type", async () => {
    const since = Date.now() - 3_600_000;
    const r = await importTranscripts(since, 400, root);
    expect(r.files).toBe(2);
    expect(rows()).toEqual([
      {
        call_key: "m1",
        kind: "main",
        agent_type: null,
        output_tokens: 90,
        role: "implement",
      },
      {
        call_key: "s1",
        kind: "review",
        agent_type: "review-security",
        output_tokens: 20,
        role: "implement",
      },
    ]);
  });

  it("reads only what was added since the last pass", async () => {
    const since = Date.now() - 3_600_000;
    await importTranscripts(since, 400, root);
    expect((await importTranscripts(since, 400, root)).calls).toBe(0);
    fs.appendFileSync(main, line("m2"));
    expect((await importTranscripts(since, 400, root)).calls).toBe(1);
    expect(rows().map((r) => (r as { call_key: string }).call_key)).toEqual([
      "m1",
      "m2",
      "s1",
    ]);
  });

  it("leaves a line still being written for the next pass", async () => {
    const since = Date.now() - 3_600_000;
    fs.appendFileSync(main, line("m3").trimEnd());
    await importTranscripts(since, 400, root);
    expect(
      rows().map((r) => (r as { call_key: string }).call_key)
    ).not.toContain("m3");
    fs.appendFileSync(main, "\n");
    await importTranscripts(since, 400, root);
    expect(rows().map((r) => (r as { call_key: string }).call_key)).toContain(
      "m3"
    );
  });

  it("skips transcripts of sessions AgentOS doesn't know", async () => {
    fs.writeFileSync(
      path.join(root, "-tmp-work", `${randomUUID()}.jsonl`),
      line("x1")
    );
    await importTranscripts(Date.now() - 3_600_000, 400, root);
    expect(
      rows().map((r) => (r as { call_key: string }).call_key)
    ).not.toContain("x1");
  });

  it("drains a backlog larger than the cap over several passes", async () => {
    const since = Date.now() - 3_600_000;
    const dir = path.join(root, "-tmp-work");
    const ids: string[] = [];
    for (let i = 0; i < 9; i++) {
      const cid = randomUUID();
      const sid = randomUUID();
      db.prepare(
        `INSERT INTO sessions (id, name, tmux_name, working_directory, task_status, claude_session_id)
         VALUES (?, 'bulk', ?, '/tmp', 'running', ?)`
      ).run(sid, `claude-${sid}`, cid);
      const file = path.join(dir, `${cid}.jsonl`);
      fs.writeFileSync(file, line(`bulk-${i}`));
      const t = new Date(Date.now() - (9 - i) * 1000);
      fs.utimesSync(file, t, t);
      ids.push(`bulk-${i}`);
    }
    // 11 files in all (the two from setup), 4 at a time.
    let passes = 0;
    for (; passes < 10; passes++)
      if ((await importTranscripts(since, 4, root)).files === 0) break;
    expect(passes).toBe(3);
    const keys = rows().map((r) => (r as { call_key: string }).call_key);
    for (const id of ids) expect(keys).toContain(id);
  });

  it("counts a CRLF file's bytes exactly, so nothing is read twice or lost", async () => {
    const since = Date.now() - 3_600_000;
    await importTranscripts(since, 400, root);
    fs.appendFileSync(main, line("c1").replace("\n", "\r\n"));
    await importTranscripts(since, 400, root);
    fs.appendFileSync(main, line("c2").replace("\n", "\r\n"));
    expect((await importTranscripts(since, 400, root)).calls).toBe(1);
    const keys = rows().map((r) => (r as { call_key: string }).call_key);
    expect(keys).toEqual(expect.arrayContaining(["c1", "c2"]));
  });
});
