import fs from "fs";
import os from "os";
import path from "path";
import { beforeAll, describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES, readImage } from "./images";

let dir: string;
beforeAll(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agentos-img-")));
  fs.writeFileSync(path.join(dir, "chart.svg"), "<svg/>");
  fs.writeFileSync(path.join(dir, "notes.txt"), "secret");
  fs.writeFileSync(path.join(dir, "page.html"), "<p/>");
  fs.mkdirSync(path.join(dir, "folder.png"));
  fs.symlinkSync(path.join(dir, "notes.txt"), path.join(dir, "link.png"));
  const big = path.join(dir, "big.png");
  fs.writeFileSync(big, "");
  fs.truncateSync(big, MAX_IMAGE_BYTES + 1);
});

describe("readImage", () => {
  it("serves an image file with its type", async () => {
    const image = await readImage(path.join(dir, "chart.svg"));
    expect(image?.type).toBe("image/svg+xml");
    expect(image?.data.toString()).toBe("<svg/>");
  });

  it("refuses anything that isn't an image file", async () => {
    for (const p of [
      path.join(dir, "notes.txt"),
      path.join(dir, "page.html"),
      "chart.svg",
      path.join(dir, "folder.png"),
      path.join(dir, "missing.png"),
      path.join(dir, "big.png"),
    ])
      expect(await readImage(p), p).toBeNull();
  });

  it("refuses an image-named link to a file that isn't one", async () => {
    expect(await readImage(path.join(dir, "link.png"))).toBeNull();
  });
});
