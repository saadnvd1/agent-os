import { describe, expect, it, vi } from "vitest";

const calls: string[] = [];
let stdout = "";
vi.mock("@/lib/hosts", () => ({
  hostExec: async (_host: string, cmd: string) => {
    calls.push(cmd);
    return { stdout, stderr: "" };
  },
}));

const { tmuxPane } = await import("./tmux-pane");

const SEP = "\n@@aos-pane@@";

describe("tmuxPane", () => {
  it("splits the pane text from its cursor row and copy-mode flag", async () => {
    stdout = `line one\n❯ hi${SEP}3 1\n`;
    expect(await tmuxPane("local", "s").view()).toEqual({
      text: "line one\n❯ hi",
      cursorY: 3,
      inMode: true,
    });
    stdout = `x${SEP}12 0\n`;
    expect(await tmuxPane("local", "s").view()).toMatchObject({
      cursorY: 12,
      inMode: false,
    });
  });

  it("gives no cursor row when tmux doesn't say", async () => {
    stdout = `x${SEP}\n`;
    expect(await tmuxPane("local", "s").view()).toEqual({
      text: "x",
      cursorY: null,
      inMode: false,
    });
  });

  it("quotes the text and targets the session exactly", async () => {
    calls.length = 0;
    const pane = tmuxPane("local", "my sess");
    await pane.type(`it's "quoted"; rm -rf /`);
    await pane.paste("pasted");
    await pane.enter();
    expect(calls[0]).toBe(
      `tmux send-keys -t '=my sess:' -l 'it'\\''s "quoted"; rm -rf /'`
    );
    expect(calls[1]).toMatch(
      /^printf %s 'pasted' \| tmux load-buffer -b 'aos-bus-[0-9a-f]{8}' - && tmux paste-buffer -p -d -b 'aos-bus-[0-9a-f]{8}' -t '=my sess:'$/
    );
    expect(calls[2]).toBe(`tmux send-keys -t '=my sess:' Enter`);
  });
});
