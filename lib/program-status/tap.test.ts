import net from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { acceptTapConnection } from "./tap";
import { programSummary, reloadProgramStatus } from "./store";

const path = join(mkdtempSync(join(tmpdir(), "osc7501-tap-")), "t.sock");
const server = net.createServer(acceptTapConnection);
const NAME = "shell-tap-test";

beforeAll(() => new Promise<void>((r) => server.listen(path, r)));
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  getDb().prepare(`DELETE FROM program_status`).run();
  reloadProgramStatus();
});

const open = () =>
  new Promise<net.Socket>((resolve) => {
    const s = net.connect(path, () => resolve(s));
  });
const closed = (s: net.Socket) =>
  new Promise<boolean>((resolve) => {
    if (s.destroyed) return resolve(true);
    s.once("close", () => resolve(true));
    setTimeout(() => resolve(false), 500);
  });
const settle = () => new Promise((r) => setTimeout(r, 50));
const done = (msg = "") =>
  `\x1b]7501;state=done${msg && `:msg=${Buffer.from(msg).toString("base64")}`}\x1b\\`;

describe("the tap socket", () => {
  it("applies reports from a named pane, split anywhere", async () => {
    const s = await open();
    const bytes = `${NAME}\nnoise ${done("finished")} more`;
    for (const part of [
      bytes.slice(0, 5),
      bytes.slice(5, 22),
      bytes.slice(22),
    ]) {
      s.write(part);
      await settle();
    }
    expect(programSummary(NAME)).toMatchObject({
      state: "done",
      msg: "finished",
    });
    s.destroy();
  });

  it("refuses a name tmux couldn't have", async () => {
    const s = await open();
    s.write(`../x:y\n${done()}`);
    expect(await closed(s)).toBe(true);
    expect(programSummary("../x:y")).toBeNull();
  });

  it("refuses a header that never ends", async () => {
    const s = await open();
    s.write("a".repeat(300));
    expect(await closed(s)).toBe(true);
  });

  it("lets a newer pipe for the pane take over from the old one", async () => {
    const old = await open();
    old.write(`${NAME}\n`);
    await settle();
    const fresh = await open();
    fresh.write(`${NAME}\n${done("new")}`);
    expect(await closed(old)).toBe(true);
    await settle();
    expect(programSummary(NAME)?.msg).toBe("new");
    fresh.destroy();
  });

  it("drops a flood past 50 reports a second", async () => {
    const s = await open();
    const flood = Array.from(
      { length: 500 },
      (_, i) => `\x1b]7501;state=done:id=r${i}\x1b\\`
    ).join("");
    s.write(`${NAME}\n${flood}`);
    await settle();
    await settle();
    const rows = getDb()
      .prepare(`SELECT records FROM program_status WHERE session_name = ?`)
      .get(NAME) as { records: string };
    expect(Object.keys(JSON.parse(rows.records)).length).toBe(50);
    s.destroy();
  });
});
