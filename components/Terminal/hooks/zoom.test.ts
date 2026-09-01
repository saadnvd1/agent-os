import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  zoomFontSize,
  MIN_FONT_SIZE,
  MAX_FONT_SIZE,
} from "./zoom";

describe("zoomFontSize", () => {
  it("scales up proportionally to the distance ratio", () => {
    assert.equal(zoomFontSize(100, 200, 14), 28);
    assert.equal(zoomFontSize(100, 150, 14), 21);
  });

  it("scales down proportionally to the distance ratio", () => {
    assert.equal(zoomFontSize(100, 50, 14), MIN_FONT_SIZE);
    assert.equal(zoomFontSize(200, 150, 16), 12);
  });

  it("clamps to the minimum font size", () => {
    assert.equal(zoomFontSize(100, 10, 14), MIN_FONT_SIZE);
  });

  it("clamps to the maximum font size", () => {
    assert.equal(zoomFontSize(100, 500, 14), MAX_FONT_SIZE);
  });

  it("rounds to whole pixels", () => {
    assert.equal(zoomFontSize(100, 133, 14), 19);
  });

  it("returns the start size when the start distance is zero", () => {
    assert.equal(zoomFontSize(0, 100, 14), 14);
  });
});
