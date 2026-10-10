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
