import { describe, expect, it } from "vitest";
import {
  FORK_PLACEHOLDER,
  leaveForkMode,
  placeholderFor,
  suggestionFor,
  type ForkDraft,
} from "./fork-draft";
import { forkLabel, runningNote, startedToast } from "./Forks";
import { startedText } from "@/lib/fork/note";
import type { ChildView } from "@/lib/fork/types";

const draft: ForkDraft = {
  sessionId: "s",
  quote: "the text",
  own: true,
  mode: true,
};

describe("Fork mode composer", () => {
  it("hides the parent's suggestion and uses the fork placeholder", () => {
    expect(
      suggestionFor("what does --rollback --to do", null, true)
    ).toBeNull();
    expect(suggestionFor("next", null, false)).toBe("next");
    expect(suggestionFor("next", "next", false)).toBeNull();
    expect(placeholderFor(true, true, "Work")).toBe(FORK_PLACEHOLDER);
    expect(placeholderFor(true, false, "Work")).toBe("Message Work");
    expect(placeholderFor(false, true, "Work")).toBe("Reconnecting…");
  });

  it("keeps the quote and drops only the Fork mode on leaving", () => {
    expect(leaveForkMode(draft)).toEqual({ ...draft, mode: false });
    expect(leaveForkMode({ ...draft, quote: "" })).toBeNull();
  });
});

describe("fork copy", () => {
  it("words the started marker and toast", () => {
    expect(startedText([1], ["Check it"])).toBe("Fork 1 started · Check it");
    expect(startedText([2, 3], ["a", "b"])).toBe("Forks 2, 3 started · a · b");
    expect(startedToast([4])).toBe("Started fork 4");
    expect(forkLabel("", "> q")).toBe("> q");
  });

  it("says how long a running fork has gone and what it's doing", () => {
    const c = {
      startedAt: 1_000,
      activity: "Read sync/worker.ts",
    } as ChildView;
    expect(runningNote(c, 1_000 + 134_000)).toBe(
      "2m 14s · Read sync/worker.ts"
    );
    expect(runningNote({ ...c, activity: null }, 6_000)).toBe("5s");
    expect(runningNote({ ...c, startedAt: null, activity: null })).toBeNull();
  });
});
