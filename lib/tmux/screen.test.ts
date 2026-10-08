import { describe, expect, it } from "vitest";
import { plainText, readInputBox } from "../status-detector";
import { PaneScreen } from "./screen";

// What a pane prints arrives as bytes: a UTF-8 string as latin1 code units.
const bytes = (s: string) => Buffer.from(s, "utf8").toString("latin1");

describe("PaneScreen", () => {
  it("keeps the visible screen from a pane's output", async () => {
    const s = new PaneScreen(20, 4);
    s.write("hello\r\nworld\r\n");
    await s.settled();
    expect(s.text()).toBe("hello\nworld");
  });

  it("follows redraws in place, as a TUI's spinner line does", async () => {
    const s = new PaneScreen(20, 3);
    s.write(bytes("⠋ Working\r"));
    s.write(bytes("\x1b[2K⠙ Working"));
    await s.settled();
    expect(s.text()).toBe("⠙ Working");
  });

  it("decodes UTF-8 split across writes", async () => {
    const s = new PaneScreen(20, 2);
    const raw = bytes("❯ hi");
    s.write(raw.slice(0, 2));
    s.write(raw.slice(2));
    await s.settled();
    expect(s.text()).toBe("❯ hi");
  });

  it("marks dim text the way the screen readers expect", async () => {
    const s = new PaneScreen(30, 4);
    s.write(
      bytes("────────────\r\n❯ \x1b[2mTry something\x1b[0m\r\n────────────")
    );
    await s.settled();
    // The placeholder is dim, so the box reads as empty.
    expect(readInputBox(s.text())).toBe("");
    expect(plainText(s.text())).toContain("Try something");
  });

  it("starts over from a capture with the cursor where tmux has it", async () => {
    const s = new PaneScreen(10, 3);
    s.write("old\r\nstuff");
    await s.reset("line one\nline two\n", 12, 3, { x: 0, y: 2 });
    s.write("three");
    await s.settled();
    expect(s.cols).toBe(12);
    expect(s.text()).toBe("line one\nline two\nthree");
  });

  it("knows the title a program set", async () => {
    const s = new PaneScreen(10, 2);
    s.write(bytes("\x1b]0;✳ Working on it\x07"));
    await s.settled();
    expect(s.windowTitle()).toBe("✳ Working on it");
  });
});
