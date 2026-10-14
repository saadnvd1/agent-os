import { describe, expect, it } from "vitest";
import { sniff } from "./sniff";

const b = (...v: number[]) => Buffer.from([...v, 0, 0, 0, 0, 0, 0, 0, 0]);

describe("sniff", () => {
  it("takes images, pdf and text by their bytes", () => {
    expect(sniff(b(0xff, 0xd8, 0xff), "a.bin")?.mediaType).toBe("image/jpeg");
    expect(sniff(b(0x89, 0x50, 0x4e, 0x47), "a")?.mediaType).toBe("image/png");
    expect(sniff(Buffer.from("%PDF-1.7"), "a")?.kind).toBe("pdf");
    expect(sniff(Buffer.from("just words é"), "n.txt")?.kind).toBe("text");
  });

  it("refuses executables, archives and scripts", () => {
    expect(sniff(b(0x7f, 0x45, 0x4c, 0x46), "a")).toBeNull();
    expect(sniff(b(0x4d, 0x5a), "a.exe")).toBeNull();
    expect(sniff(b(0x50, 0x4b, 0x03, 0x04), "a.zip")).toBeNull();
    expect(sniff(b(0x1f, 0x8b), "a.gz")).toBeNull();
    expect(sniff(Buffer.from("#!/bin/sh\n"), "run")).toBeNull();
    expect(sniff(Buffer.from("echo hi"), "run.sh")).toBeNull();
  });
});
