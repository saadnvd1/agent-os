import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import {
  RegionError,
  cropRect,
  cropToFrame,
  frameOf,
  readCopyPath,
  reducedCopy,
  setSips,
  takeRegion,
} from "./screenshot";
import { tempDir } from "@/lib/test-temp";

afterEach(() => setSips(null));

const tmp = () => tempDir("aos-shot-");

describe("reducedCopy", () => {
  it("asks sips for 800px on the longest side, into shots/read", async () => {
    const file = path.join(tmp(), "a.png");
    fs.writeFileSync(file, "x");
    const calls: string[][] = [];
    setSips(async (args) => {
      calls.push(args);
      fs.writeFileSync(args[args.length - 1], "small");
      return "";
    });
    const out = await reducedCopy(file);
    expect(calls[0]).toEqual(["-Z", "800", file, "--out", readCopyPath(file)]);
    expect(out).toBe(readCopyPath(file));
    expect(out).not.toBe(file);
  });

  it("falls back to the full file when resizing fails", async () => {
    const file = path.join(tmp(), "a.png");
    fs.writeFileSync(file, "x");
    setSips(async () => {
      throw new Error("no sips");
    });
    expect(await reducedCopy(file)).toBe(file);
  });
});

describe("cropRect", () => {
  const image = { width: 1179, height: 2556 };
  const screen = { width: 393, height: 852 }; // 3x

  it("scales a frame to pixels and adds the margin", () => {
    expect(
      cropRect({ x: 20, y: 100, width: 100, height: 50 }, screen, image, 10)
    ).toEqual({ x: 30, y: 270, width: 360, height: 210 });
  });

  it("clamps to the image", () => {
    expect(
      cropRect({ x: 0, y: 800, width: 393, height: 52 }, screen, image, 8)
    ).toEqual({ x: 0, y: 2376, width: 1179, height: 180 });
  });

  it("refuses an element that is off the screen", () => {
    expect(() =>
      cropRect({ x: 0, y: 900, width: 10, height: 10 }, screen, image)
    ).toThrow(RegionError);
  });
});

describe("cropToFrame", () => {
  it("reads the image size and crops with sips", async () => {
    const calls: string[][] = [];
    setSips(async (args) => {
      calls.push(args);
      return args[0] === "-g" ? "pixelWidth: 1179\n  pixelHeight: 2556" : "";
    });
    await cropToFrame(
      "/x/a.png",
      { x: 20, y: 100, width: 100, height: 50 },
      { width: 393, height: 852 }
    );
    expect(calls[1]).toEqual([
      "--cropToHeightWidth",
      "198",
      "348",
      "--cropOffset",
      "276",
      "36",
      "/x/a.png",
    ]);
  });
});

describe("frameOf", () => {
  const json = JSON.stringify({
    data: {
      nodes: [
        { ref: "e1", rect: { x: 0, y: 0, width: 393, height: 852 } },
        { ref: "e2", rect: { x: 10, y: 20, width: 100, height: 40 } },
      ],
    },
  });

  it("finds the frame and the screen size", () => {
    const got = frameOf(json, "@e2");
    expect(got.frame).toEqual({ x: 10, y: 20, width: 100, height: 40 });
    expect(got.screen).toEqual({ width: 393, height: 852 });
  });

  it("says a stale or unknown ref is, and what to do", () => {
    expect(() => frameOf(json, "@e9")).toThrow(
      /unknown or stale ref @e9.*snapshot -i/
    );
    expect(() => frameOf("nope", "@e1")).toThrow(RegionError);
  });
});

describe("takeRegion", () => {
  it("pulls --region out of the args", () => {
    expect(takeRegion(["screenshot", "--region", "@e3", "a.png"])).toEqual({
      args: ["screenshot", "a.png"],
      region: "@e3",
    });
    expect(takeRegion(["screenshot", "--region=@e4"]).region).toBe("@e4");
    expect(takeRegion(["screenshot"]).region).toBeNull();
    expect(() => takeRegion(["screenshot", "--region"])).toThrow(RegionError);
  });
});
