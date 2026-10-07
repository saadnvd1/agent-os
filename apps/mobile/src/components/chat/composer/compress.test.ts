import { describe, expect, it, vi } from "vitest";

vi.mock("expo-image-manipulator", () => ({
  ImageManipulator: {},
  SaveFormat: {},
}));
const { fitWithin } = await import("./compress");

describe("fitWithin", () => {
  it("leaves an image that already fits alone", () => {
    expect(fitWithin(1200, 900)).toBeNull();
    expect(fitWithin(2048, 100)).toBeNull();
  });

  it("scales the long side down to the limit, keeping the shape", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 2048, height: 1536 });
    expect(fitWithin(1170, 2532)).toEqual({ width: 946, height: 2048 });
  });
});
