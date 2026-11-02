import { describe, expect, it } from "vitest";
import { startFailureMessage } from "./start-error";

describe("startFailureMessage", () => {
  it("hides the socket path behind a plain reason", () => {
    const m = startFailureMessage(
      new Error("The chat worker didn't start: connect ENOENT /x/y.sock")
    );
    expect(m).toBe("Couldn't start the agent: it stopped while starting");
  });
  it("leaves other errors alone", () => {
    expect(startFailureMessage(new Error("boom"))).toBe("boom");
  });
});
