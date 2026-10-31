import { describe, expect, it } from "vitest";
import { unreadCount } from "./unread";

describe("unreadCount", () => {
  it("counts recent ids newer than the seen id", () => {
    expect(unreadCount([9, 8, 7, 6], 7)).toBe(2);
    expect(unreadCount([9, 8], 9)).toBe(0);
  });
  it("is zero before the first head sets a seen id", () => {
    expect(unreadCount([9, 8], null)).toBe(0);
  });
});
