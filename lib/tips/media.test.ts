import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { tempDir } from "@/lib/test-temp";
import { applyHandback, manifest } from "./media";
import type { Media, Tip } from "./schema";

const tip = (o: Partial<Tip> & { id: string }): Tip => ({
  title: "T",
  body: "B",
  added: "2026-10-31",
  ...o,
});

const clip: Media = {
  kind: "video",
  src: "/tips/a.mp4",
  poster: "/tips/a-poster.webp",
  alt: "A clip",
  width: 768,
  height: 480,
  durationMs: 6000,
};

function project(tips: Tip[]) {
  const root = tempDir("agentos-tips-media-");
  fs.mkdirSync(path.join(root, "content"));
  fs.writeFileSync(
    path.join(root, "content/tips.json"),
    JSON.stringify({ v: 1, tips })
  );
  const from = tempDir("agentos-tips-from-");
  return { root, from };
}

describe("manifest", () => {
  it("lists only tips with a brief and no media", () => {
    const rows = manifest([
      tip({ id: "plain" }),
      tip({ id: "waits", mediaBrief: { kind: "clip", shot: "Do a thing" } }),
      tip({ id: "done", mediaBrief: { kind: "crop", shot: "x" }, media: clip }),
      tip({ id: "still", mediaBrief: { kind: "screenshot", shot: "y" } }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["waits", "still"]);
    expect(rows[0]).toMatchObject({
      dest: "public/tips/waits.mp4",
      target: { width: 768, maxSeconds: 8 },
    });
    expect(rows[1].dest).toBe("public/tips/still.webp");
  });
});

describe("applyHandback", () => {
  const briefed = tip({ id: "a", mediaBrief: { kind: "clip", shot: "s" } });

  it("copies the files, sets media and drops the brief", () => {
    const { root, from } = project([briefed, tip({ id: "b" })]);
    fs.writeFileSync(path.join(from, "a.mp4"), "v");
    fs.writeFileSync(path.join(from, "a-poster.webp"), "p");
    applyHandback(root, from, { a: clip });
    const out = JSON.parse(
      fs.readFileSync(path.join(root, "content/tips.json"), "utf-8")
    );
    expect(out.tips[0].media).toEqual(clip);
    expect(out.tips[0].mediaBrief).toBeUndefined();
    expect(fs.existsSync(path.join(root, "public/tips/a.mp4"))).toBe(true);
  });

  it("refuses an unknown id, a missing file or an oversize file, changing nothing", () => {
    const { root, from } = project([briefed]);
    const before = fs.readFileSync(
      path.join(root, "content/tips.json"),
      "utf-8"
    );
    expect(() => applyHandback(root, from, { zzz: clip })).toThrow(
      /Unknown tip/
    );
    expect(() => applyHandback(root, from, { a: clip })).toThrow(/missing/);
    fs.writeFileSync(path.join(from, "a.mp4"), Buffer.alloc(600 * 1024));
    fs.writeFileSync(path.join(from, "a-poster.webp"), "p");
    expect(() => applyHandback(root, from, { a: clip })).toThrow(/over/);
    expect(fs.readFileSync(path.join(root, "content/tips.json"), "utf-8")).toBe(
      before
    );
    expect(fs.existsSync(path.join(root, "public/tips"))).toBe(false);
  });

  it("refuses a clip longer than 8 seconds", () => {
    const { root, from } = project([briefed]);
    fs.writeFileSync(path.join(from, "a.mp4"), "v");
    fs.writeFileSync(path.join(from, "a-poster.webp"), "p");
    expect(() =>
      applyHandback(root, from, { a: { ...clip, durationMs: 9000 } as Media })
    ).toThrow(/longer/);
  });
});
