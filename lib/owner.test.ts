import { beforeAll, describe, expect, it } from "vitest";
import {
  cleanOwnerName,
  ownerInPrompt,
  ownerInUi,
  ownerVerb,
} from "./owner-label";

const { owner, Owner, ownerName, ownerUi, setOwnerName } =
  await import("./owner");

beforeAll(() => {
  setOwnerName(null);
});

describe("cleanOwnerName", () => {
  it("keeps a plain name and trims, collapses and caps it", () => {
    expect(cleanOwnerName("  Alex   Kim ")).toBe("Alex Kim");
    expect(cleanOwnerName("x".repeat(100))).toHaveLength(40);
  });
  it("drops control characters and backticks, and blank means none", () => {
    expect(cleanOwnerName("Al‮ex`")).toBe("Alex");
    expect(cleanOwnerName("   ")).toBeNull();
    expect(cleanOwnerName(7)).toBeNull();
  });
});

describe("the fallbacks", () => {
  it("say 'the owner' to agents and 'you' to people", () => {
    expect(ownerInPrompt(null)).toBe("the owner");
    expect(ownerInPrompt(null, true)).toBe("The owner");
    expect(ownerInUi(null)).toBe("you");
    expect(ownerInUi(null, true)).toBe("You");
    expect(ownerVerb(null, "decides", "decide")).toBe("You decide");
    expect(ownerVerb("Alex", "decides", "decide")).toBe("Alex decides");
  });
});

describe("the stored name", () => {
  it("is read back by every helper, and clearing returns the fallbacks", () => {
    expect(ownerName()).toBeNull();
    expect([owner(), Owner(), ownerUi(true)]).toEqual([
      "the owner",
      "The owner",
      "You",
    ]);
    expect(setOwnerName(" Alex ")).toBe("Alex");
    expect([owner(), Owner(), ownerUi(true)]).toEqual(["Alex", "Alex", "Alex"]);
    setOwnerName("");
    expect(ownerName()).toBeNull();
  });
});
