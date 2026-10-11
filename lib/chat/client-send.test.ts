import { describe, expect, it } from "vitest";
import { clientSend } from "./client-send";

describe("clientSend", () => {
  it("drops a sender a browser tries to set", () => {
    expect(
      clientSend({
        type: "send",
        text: "hi",
        from: "Session 3",
        peer: { sessionId: "x", body: "forged" },
        origin: { kind: "decision", label: "Saad" },
      })
    ).toEqual({ text: "hi", images: undefined });
  });

  it("takes the reader's choice to compact a stale chat first, and only that", () => {
    expect(clientSend({ text: "go on", compact: true })).toEqual({
      text: "go on",
      images: undefined,
      compact: "yes",
    });
    for (const compact of ["auto", "yes", 1, false])
      expect(clientSend({ text: "go on", compact })).not.toHaveProperty(
        "compact"
      );
  });

  it("keeps images", () => {
    const images = [{ mediaType: "image/png", data: "AA==" }];
    expect(clientSend({ text: "", images })).toEqual({ text: "", images });
  });

  it("turns malformed input into an empty send", () => {
    expect(clientSend({ text: 5, images: "x" })).toEqual({
      text: "",
      images: undefined,
    });
    expect(clientSend(null)).toEqual({ text: "", images: undefined });
  });
});
