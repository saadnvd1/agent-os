import net from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { getDb } from "@/lib/db";
import { acceptTapConnection } from "./tap";
import { programSummary, reloadProgramStatus } from "./store";

const path = join(mkdtempSync(join(tmpdir(), "osc7501-tap-")), "t.sock");
const server = net.createServer(acceptTapConnection);
const NAME = "shell-tap-test";

beforeAll(() => new Promise<void>((r) => server.listen(path, r)));
afterAll(() => {
  server.close();
});
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
    await vi.waitFor(() =>
      expect(programSummary(NAME)).toMatchObject({
        state: "done",
        msg: "finished",
      })
    );
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
    old.write(`${NAME}\n${done("old")}`);
    await vi.waitFor(() => expect(programSummary(NAME)?.msg).toBe("old"));
    const fresh = await open();
    fresh.write(`${NAME}\n${done("new")}`);
    expect(await closed(old)).toBe(true);
    await vi.waitFor(() => expect(programSummary(NAME)?.msg).toBe("new"));
    fresh.destroy();
  });

  it("caps a flood at 50 reports a second, keeping the one that ends it", async () => {
    const s = await open();
    const flood = Array.from(
      { length: 500 },
      (_, i) => `\x1b]7501;state=done:id=r${i}\x1b\\`
    ).join("");
    s.write(`${NAME}\n${flood}\x1b]7501;state=clear\x1b\\${done("over")}`);
    const count = () => {
      const row = getDb()
        .prepare(`SELECT records FROM program_status WHERE session_name = ?`)
        .get(NAME) as { records: string } | undefined;
      return row ? Object.keys(JSON.parse(row.records)).length : 0;
    };
    // The first 50 go in at once; the rest wait for the second to end.
    await vi.waitFor(() => expect(count()).toBe(50), {
      timeout: 900,
      interval: 5,
    });
    // Then the clear and the final done land.
    await vi.waitFor(
      () =>
        expect(programSummary(NAME)).toMatchObject({
          state: "done",
          msg: "over",
        }),
      { timeout: 3000 }
    );
    // The clear took the deferred records with it.
    expect(count()).toBe(1);
    s.destroy();
  });
});
