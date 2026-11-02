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
        origin: { kind: "decision", label: "The owner" },
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

  it("keeps the client's own id only in its own shape", () => {
    expect(clientSend({ text: "hi", clientId: "user-c-1a2b3c4d" })).toEqual({
      text: "hi",
      images: undefined,
      id: "user-c-1a2b3c4d",
    });
    for (const clientId of [
      "user-1712-abcde",
      "user-c-short",
      "user-c-../../x1234",
      "error-c-12345678",
      `user-c-${"a".repeat(65)}`,
      42,
    ])
      expect(clientSend({ text: "hi", clientId })).not.toHaveProperty("id");
  });

  it("keeps only files that are in the attachments folder", () => {
    expect(
      clientSend({ text: "x", files: [{ path: "/etc/passwd" }] }).files
    ).toBeUndefined();
  });
});
