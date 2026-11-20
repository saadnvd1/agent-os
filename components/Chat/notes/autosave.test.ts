import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutosaver, type SaveState } from "./autosave";
import { noteIsEmpty } from "@/lib/notes/isEmpty";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(save = vi.fn(async (_v: string) => {})) {
  const states: SaveState[] = [];
  const saver = createAutosaver<string>({
    save,
    delay: 1000,
    onState: (s) => states.push(s),
  });
  return { saver, save, states };
}

describe("note autosave", () => {
  it("saves once, with the last value, a second after edits stop", async () => {
    const { saver, save, states } = setup();
    saver.change("a");
    await vi.advanceTimersByTimeAsync(500);
    saver.change("ab");
    await vi.advanceTimersByTimeAsync(999);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("ab");
    expect(states.at(-1)).toBe("saved");
  });

  it("flush (blur, close) saves at once and the timer then has nothing to send", async () => {
    const { saver, save } = setup();
    saver.change("draft");
    await saver.flush();
    expect(save).toHaveBeenCalledWith("draft");
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("flush with nothing waiting saves nothing", async () => {
    const { saver, save } = setup();
    await saver.flush();
    expect(save).not.toHaveBeenCalled();
  });

  it("an edit during a save is saved after it, never two at once", async () => {
    let release!: () => void;
    let inFlight = 0;
    let most = 0;
    const save = vi.fn(async (_v: string) => {
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise<void>((r) => (release = r));
      inFlight--;
    });
    const { saver } = setup(save);
    saver.change("one");
    const first = saver.flush();
    saver.change("two");
    const second = saver.flush();
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);
    release();
    await Promise.all([first, second]);
    expect(save.mock.calls.map((c) => c[0])).toEqual(["one", "two"]);
    expect(most).toBe(1);
  });

  it("a failed save is retried with the newest value on the next flush", async () => {
    const save = vi
      .fn<(v: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue();
    const { saver, states } = setup(save);
    saver.change("kept");
    await saver.flush();
    expect(states.at(-1)).toBe("error");
    await saver.flush();
    expect(save).toHaveBeenLastCalledWith("kept");
    expect(states.at(-1)).toBe("saved");
  });
});

describe("noteIsEmpty", () => {
  it("is empty for no note or only blank paragraphs", () => {
    expect(noteIsEmpty(null)).toBe(true);
    expect(
      noteIsEmpty({
        type: "doc",
        content: [
          { type: "paragraph" },
          { type: "paragraph", content: [{ type: "text", text: "  " }] },
        ],
      })
    ).toBe(true);
  });

  it("is not empty with text or any other block", () => {
    expect(
      noteIsEmpty({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "x" }] },
        ],
      })
    ).toBe(false);
    expect(
      noteIsEmpty({ type: "doc", content: [{ type: "horizontalRule" }] })
    ).toBe(false);
  });
});
