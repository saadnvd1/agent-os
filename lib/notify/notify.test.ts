import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collapse, Limiter } from "./limiter";
import { commandNotifier, selectNotifier, telegramNotifier } from "./notifiers";

const TOKEN = "123456:SECRET-bot-token-abc";

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aos-notify-"));
  return path.join(dir, "out.txt");
}

describe("selectNotifier", () => {
  it("uses the command when AGENTOS_NOTIFY_CMD is set, over Telegram", () => {
    const n = selectNotifier(
      { AGENTOS_NOTIFY_CMD: "cat >/dev/null" },
      { token: TOKEN, chatId: "42" }
    );
    expect(n?.kind).toBe("command");
  });

  it("uses Telegram when it has both a token and a chat id", () => {
    expect(selectNotifier({}, { token: TOKEN, chatId: "42" })?.kind).toBe(
      "telegram"
    );
    expect(selectNotifier({}, { token: TOKEN, chatId: null })).toBeNull();
    expect(selectNotifier({ AGENTOS_NOTIFY_CMD: "  " }, null)).toBeNull();
  });
});

describe("commandNotifier", () => {
  it("runs the command with the message on stdin", async () => {
    const out = tmpFile();
    await commandNotifier(`cat >> '${out}'`).send("hello\nphone");
    expect(fs.readFileSync(out, "utf8")).toBe("hello\nphone");
  });

  it("fails with the exit code and the last line of stderr", async () => {
    await expect(
      commandNotifier("echo nope >&2; exit 3").send("x")
    ).rejects.toThrow("the notify command exited 3: nope");
  });

  it("gives up on a command that hangs", async () => {
    await expect(commandNotifier("sleep 5", 50).send("x")).rejects.toThrow(
      /took over/
    );
  });
});

describe("telegramNotifier", () => {
  it("posts the text to the chat", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    await telegramNotifier(TOKEN, "42", fetchImpl as never).send("hi");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(JSON.parse(String(init.body))).toEqual({
      chat_id: "42",
      text: "hi",
    });
  });

  it("never puts the token in an error", async () => {
    const refused = vi.fn(
      async () =>
        new Response(JSON.stringify({ description: `bad token ${TOKEN}` }), {
          status: 401,
        })
    );
    const err = await telegramNotifier(TOKEN, "42", refused as never)
      .send("hi")
      .catch((e: Error) => e);
    expect(String(err)).toContain("Telegram refused it (401");
    expect(String(err)).not.toContain(TOKEN);

    const unreachable = vi.fn(async () => {
      throw new Error(
        `fetch failed for https://api.telegram.org/bot${TOKEN}/x`
      );
    });
    const err2 = await telegramNotifier(TOKEN, "42", unreachable as never)
      .send("hi")
      .catch((e: Error) => e);
    expect(String(err2)).toContain("couldn't reach Telegram");
    expect(String(err2)).not.toContain(TOKEN);
  });
});

describe("Limiter", () => {
  function setup() {
    let now = 0;
    const sent: string[] = [];
    const limiter = new Limiter(
      async (t) => {
        sent.push(t);
      },
      { now: () => now }
    );
    return { limiter, sent, advance: (ms: number) => (now += ms) };
  }
  afterEach(() => vi.useRealTimers());

  it("sends the first at once and holds the rest of the minute", async () => {
    vi.useFakeTimers();
    const { limiter, sent, advance } = setup();
    expect(await limiter.push("a", "one")).toEqual({ state: "sent" });
    advance(10_000);
    expect(await limiter.push("a", "two")).toEqual({
      state: "held",
      inMs: 50_000,
    });
    expect(await limiter.push("a", "three")).toMatchObject({ state: "held" });
    expect(sent).toEqual(["one"]);
    await limiter.flush("a");
    expect(sent).toEqual(["one", collapse(["two", "three"])]);
    expect(sent[1]).toBe("2 updates:\n• two\n• three");
  });

  it("collapses the same text inside the minute", async () => {
    const { limiter, sent, advance } = setup();
    await limiter.push("a", "same");
    expect(await limiter.push("a", "same")).toEqual({ state: "duplicate" });
    advance(61_000);
    expect(await limiter.push("a", "same")).toEqual({ state: "sent" });
    expect(sent).toEqual(["same", "same"]);
  });

  it("limits each source on its own", async () => {
    const { limiter, sent } = setup();
    await limiter.push("a", "x");
    expect(await limiter.push("b", "y")).toEqual({ state: "sent" });
    expect(sent).toEqual(["x", "y"]);
  });

  it("sends what waited when the minute is up", async () => {
    vi.useFakeTimers();
    const { limiter, sent, advance } = setup();
    await limiter.push("a", "one");
    await limiter.push("a", "two");
    advance(60_000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent).toEqual(["one", "two"]);
  });

  it("reports a failed send", async () => {
    const limiter = new Limiter(async () => {
      throw new Error("boom");
    });
    expect(await limiter.push("a", "x")).toEqual({
      state: "failed",
      why: "boom",
    });
  });
});

describe("settings and logs", () => {
  it("never return or log the bot token", async () => {
    const { setTelegram, notifySettings, sendPhone } = await import(".");
    const logged: string[] = [];
    const spy = vi
      .spyOn(console, "error")
      .mockImplementation((...a) => void logged.push(a.map(String).join(" ")));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(JSON.stringify({ description: `nope ${TOKEN}` }), {
          status: 403,
        })
    );
    const before = process.env.AGENTOS_NOTIFY_CMD;
    delete process.env.AGENTOS_NOTIFY_CMD;
    try {
      setTelegram({ token: TOKEN, chatId: "42" });
      const view = notifySettings({});
      expect(view).toEqual({
        active: "telegram",
        commandSet: false,
        telegram: { tokenSet: true, chatId: "42" },
      });
      expect(JSON.stringify(view)).not.toContain(TOKEN);
      const outcome = await sendPhone("test-source", "hi");
      expect(outcome.state).toBe("failed");
      expect(JSON.stringify(outcome)).not.toContain(TOKEN);
      expect(logged.join("\n")).toContain("test-source didn't send");
      expect(logged.join("\n")).not.toContain(TOKEN);
      // A chat id change keeps the stored token.
      setTelegram({ chatId: "43" });
      expect(notifySettings({}).telegram).toEqual({
        tokenSet: true,
        chatId: "43",
      });
      setTelegram({ token: null, chatId: null });
      expect(notifySettings({}).active).toBeNull();
    } finally {
      spy.mockRestore();
      fetchSpy.mockRestore();
      if (before !== undefined) process.env.AGENTOS_NOTIFY_CMD = before;
    }
  });

  it("refuses to send when nothing is set up", async () => {
    const { sendPhone, NotConfigured } = await import(".");
    const before = process.env.AGENTOS_NOTIFY_CMD;
    delete process.env.AGENTOS_NOTIFY_CMD;
    try {
      await expect(sendPhone("x", "hi")).rejects.toBeInstanceOf(NotConfigured);
    } finally {
      if (before !== undefined) process.env.AGENTOS_NOTIFY_CMD = before;
    }
  });

  it("sends through the command from the environment", async () => {
    const { sendPhone } = await import(".");
    const out = tmpFile();
    const before = process.env.AGENTOS_NOTIFY_CMD;
    process.env.AGENTOS_NOTIFY_CMD = `cat >> '${out}'`;
    try {
      expect(await sendPhone("env-source", "test from AgentOS")).toEqual({
        state: "sent",
      });
      expect(fs.readFileSync(out, "utf8")).toBe("test from AgentOS");
    } finally {
      if (before === undefined) delete process.env.AGENTOS_NOTIFY_CMD;
      else process.env.AGENTOS_NOTIFY_CMD = before;
    }
  });
});
