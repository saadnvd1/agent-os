import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import { db } from "../db";
import {
  claimNext,
  deleteQueued,
  editQueued,
  enqueue,
  listQueue,
  MAX_QUEUED,
  MAX_QUEUED_TEXT,
  moveQueued,
  moveToFront,
} from "./queued";

const session = () => {
  const id = randomUUID();
  for (const text of ["a", "b", "c"]) enqueue(id, { id: `user-${text}`, text });
  return id;
};
const texts = (id: string) => listQueue(id).map((m) => m.text);

describe("chat queue", () => {
  it("keeps messages in the order they were queued, per session", () => {
    const id = session();
    const other = session();
    deleteQueued(other, "user-a");
    expect(texts(id)).toEqual(["a", "b", "c"]);
    expect(texts(other)).toEqual(["b", "c"]);
  });

  it("queues a retried message once", () => {
    const id = session();
    enqueue(id, { id: "user-a", text: "a again" });
    expect(texts(id)).toEqual(["a", "b", "c"]);
  });

  it("keeps images to send, and shows watchers only how many", () => {
    const id = randomUUID();
    const images = [{ mediaType: "image/png", data: "AAAA" }];
    enqueue(id, { id: "user-1", text: "look", images });
    expect(listQueue(id)[0]).toMatchObject({ text: "look", imageCount: 1 });
    expect(JSON.stringify(listQueue(id))).not.toContain("AAAA");
    // The count comes from its own column: listing never reads the images.
    db.prepare(
      `UPDATE chat_queue SET images = 'not json' WHERE id = 'user-1'`
    ).run();
    expect(listQueue(id)[0].imageCount).toBe(1);
    db.prepare(`UPDATE chat_queue SET images = ? WHERE id = 'user-1'`).run(
      JSON.stringify(images)
    );
    enqueue(id, { id: "user-2", text: "none" });
    expect(listQueue(id)[1].imageCount).toBeUndefined();
    expect(claimNext(id)?.images).toEqual(images);
  });

  it("refuses to grow past its cap, or take an oversized message", () => {
    const id = randomUUID();
    for (let i = 0; i < MAX_QUEUED; i++)
      enqueue(id, { id: `user-${i}`, text: `m${i}` });
    expect(() => enqueue(id, { id: "user-x", text: "one more" })).toThrow(
      /full/
    );
    const other = randomUUID();
    const long = "x".repeat(MAX_QUEUED_TEXT + 1);
    expect(() => enqueue(other, { id: "user-1", text: long })).toThrow(
      /too long/
    );
    enqueue(other, { id: "user-2", text: "short" });
    expect(editQueued(other, "user-2", long)).toBe(false);
    expect(texts(other)).toEqual(["short"]);
  });

  it("claims from the front, each message once", () => {
    const id = session();
    expect(claimNext(id)?.text).toBe("a");
    expect(claimNext(id)?.text).toBe("b");
    expect(texts(id)).toEqual(["c"]);
    expect(claimNext(id)?.text).toBe("c");
    expect(claimNext(id)).toBeNull();
  });

  it("moves a message up or down, and not past either end", () => {
    const id = session();
    expect(moveQueued(id, "user-c", -1)).toBe(true);
    expect(texts(id)).toEqual(["a", "c", "b"]);
    expect(moveQueued(id, "user-a", -1)).toBe(false);
    expect(moveQueued(id, "user-b", 1)).toBe(false);
    expect(moveQueued(id, "user-a", 1)).toBe(true);
    expect(texts(id)).toEqual(["c", "a", "b"]);
    // New messages still go at the back.
    enqueue(id, { id: "user-d", text: "d" });
    expect(texts(id)).toEqual(["c", "a", "b", "d"]);
  });

  it("puts a message at the front to go next, only while it's queued", () => {
    const id = session();
    expect(moveToFront(id, "user-c")).toBe(true);
    expect(claimNext(id)?.text).toBe("c");
    expect(moveToFront(id, "user-c")).toBe(false);
    expect(moveToFront(id, "user-never")).toBe(false);
  });

  it("edits and deletes only what's still queued", () => {
    const id = session();
    expect(editQueued(id, "user-b", "B")).toBe(true);
    expect(texts(id)).toEqual(["a", "B", "c"]);
    claimNext(id);
    expect(editQueued(id, "user-a", "too late")).toBe(false);
    expect(deleteQueued(id, "user-a")).toBe(false);
    expect(deleteQueued(id, "user-c")).toBe(true);
    expect(texts(id)).toEqual(["B"]);
  });
});
