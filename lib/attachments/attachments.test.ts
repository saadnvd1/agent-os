import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { agentText, documentBlocks } from "./message";
import { checkUpload } from "./check";
import {
  ATTACHMENT_LIMITS,
  acceptAttr,
  limitFor,
  typeFor,
  unsupportedMessage,
} from "./policy";
import { attachmentsRoot, resolveFiles, saveAttachment } from "./store";

const L_TEXT = ATTACHMENT_LIMITS.maxTextBytes;
const SCOPE = "test-attachments-scope";

afterEach(() => {
  fs.rmSync(path.join(attachmentsRoot(), SCOPE), {
    recursive: true,
    force: true,
  });
});

describe("policy", () => {
  it("knows types by extension, any case", () => {
    expect(typeFor("A.XLSX")?.kind).toBe("sheet");
    expect(typeFor("x.docx")?.kind).toBe("doc");
    expect(typeFor("x.zip")).toBeNull();
    expect(acceptAttr()).toContain(".pdf");
  });
});

describe("policy table", () => {
  it.each([
    ["trace.har", "text", "application/json"],
    ["photo.HEIC", "image", "image/heic"],
    ["photo.heif", "image", "image/heic"],
    ["logo.svg", "text", "text/plain"],
    ["deploy.sh", "text", "text/plain"],
    ["a.bash", "text", "text/plain"],
    ["a.zsh", "text", "text/plain"],
    ["a.fish", "text", "text/plain"],
    ["a.ini", "text", "text/plain"],
    ["a.conf", "text", "text/plain"],
    ["a.cfg", "text", "text/plain"],
    ["a.properties", "text", "text/plain"],
    ["main.tf", "text", "text/plain"],
    ["vars.hcl", "text", "text/plain"],
    ["q.graphql", "text", "text/plain"],
    ["q.gql", "text", "text/plain"],
    ["a.proto", "text", "text/plain"],
    ["a.vue", "text", "text/plain"],
    ["a.svelte", "text", "text/plain"],
    ["a.astro", "text", "text/plain"],
    ["a.dart", "text", "text/plain"],
    ["a.lua", "text", "text/plain"],
    ["a.R", "text", "text/plain"],
    ["a.scala", "text", "text/plain"],
    ["a.ex", "text", "text/plain"],
    ["a.exs", "text", "text/plain"],
    ["a.erl", "text", "text/plain"],
    ["a.zig", "text", "text/plain"],
    ["flake.nix", "text", "text/plain"],
    ["events.ndjson", "text", "application/json"],
    ["a.srt", "text", "application/x-subrip"],
    ["a.vtt", "text", "text/vtt"],
    ["cal.ics", "text", "text/calendar"],
    ["mail.eml", "text", "message/rfc822"],
    ["a.out", "text", "text/plain"],
    ["a.err", "text", "text/plain"],
    ["Cargo.lock", "text", "text/plain"],
    ["Dockerfile", "text", "text/plain"],
    ["Makefile", "text", "text/plain"],
    ["Procfile", "text", "text/plain"],
    ["Gemfile", "text", "text/plain"],
    ["Rakefile", "text", "text/plain"],
    [".gitignore", "text", "text/plain"],
    [".env.example", "text", "text/plain"],
    ["env.example", "text", "text/plain"],
    ["/some/dir/Dockerfile", "text", "text/plain"],
  ])("takes %s", (name, kind, mediaType) => {
    expect(typeFor(name)).toMatchObject({ kind, mediaType });
  });

  it("still refuses binaries and unknown names", () => {
    for (const n of ["a.zip", "a.exe", "a.dmg", "noext", "a.mov", ".env.prod"])
      expect(typeFor(n), n).toBeNull();
    expect(unsupportedMessage("a.zip")).toContain("HAR");
  });

  it("flags HAR on the chip", () => {
    expect(typeFor("x.har")?.note).toBe("auth headers redacted");
    expect(typeFor("x.json")?.note).toBeUndefined();
  });

  it("lets text be big, images small, HEIC the document size", () => {
    const L = ATTACHMENT_LIMITS;
    expect(L.maxTextBytes).toBe(100_000_000);
    expect(limitFor(typeFor("x.har")!)).toBe(L.maxTextBytes);
    expect(limitFor(typeFor("x.png")!)).toBe(L.maxImageBytes);
    expect(limitFor(typeFor("x.heic")!)).toBe(L.maxBytes);
    expect(limitFor(typeFor("x.xlsx")!)).toBe(L.maxBytes);
  });

  it("checks a big log against the text limit and an HEIC by its bytes", () => {
    const big = (n: number) => Buffer.alloc(n, 97);
    expect(checkUpload("a.log", big(L_TEXT)).ok).toBe(true);
    expect(checkUpload("a.log", big(L_TEXT + 1))).toMatchObject({
      status: 413,
    });
    expect(
      checkUpload("a.csv", big(ATTACHMENT_LIMITS.maxBytes + 1))
    ).toMatchObject({
      status: 413,
    });
    expect(checkUpload("p.heic", Buffer.from("not an image"))).toMatchObject({
      status: 400,
    });
    const heic = Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from("ftypheic"),
      Buffer.alloc(16),
    ]);
    expect(checkUpload("p.heic", heic).ok).toBe(true);
  });
});

describe("resolveFiles", () => {
  it("keeps files in the attachments folder, with size and type from disk", () => {
    const f = saveAttachment(SCOPE, "a.csv", Buffer.from("a,b\n"), "text/csv");
    const [got] = resolveFiles([{ ...f, size: 999, mediaType: "x/y" }])!;
    expect(got).toMatchObject({
      name: "a.csv",
      size: 4,
      mediaType: "text/csv",
    });
  });

  it("drops paths outside it, missing files and symlinks out of it", () => {
    const f = saveAttachment(SCOPE, "a.csv", Buffer.from("x"), "text/csv");
    const outside = path.join(path.dirname(attachmentsRoot()), "outside.txt");
    fs.writeFileSync(outside, "secret");
    const link = path.join(path.dirname(f.path), "link.txt");
    fs.symlinkSync(outside, link);
    try {
      expect(
        resolveFiles([
          { path: outside },
          { path: link },
          { path: path.join(attachmentsRoot(), SCOPE, "gone.csv") },
          { path: path.dirname(f.path) },
          { path: 5 },
          null,
        ])
      ).toBeUndefined();
    } finally {
      fs.rmSync(outside);
    }
  });

  it("takes at most the limit and nothing that isn't a list", () => {
    const f = saveAttachment(SCOPE, "a.csv", Buffer.from("x"), "text/csv");
    expect(resolveFiles("nope")).toBeUndefined();
    expect(resolveFiles(Array.from({ length: 20 }, () => f))).toHaveLength(
      ATTACHMENT_LIMITS.max
    );
  });
});

describe("what the agent reads", () => {
  const file = {
    path: "/data/attachments/s/q3.xlsx",
    name: "q3.xlsx",
    size: 2500,
    mediaType: "application/vnd.ms-excel",
  };

  it("lists each file's absolute path after the text", () => {
    const text = agentText("summarise this", [file]);
    expect(text.startsWith("summarise this\n\n")).toBe(true);
    expect(text).toContain("- /data/attachments/s/q3.xlsx (");
  });

  it("never pastes a file in: a big one is a path, a hint and its summary", () => {
    const body = "x".repeat(2_000_000);
    const f = saveAttachment(
      SCOPE,
      "big.har",
      Buffer.from(body),
      "application/json",
      "HAR summary: 3 requests, 1 hosts."
    );
    const text = agentText("look", [f]);
    expect(text).toContain(f.path);
    expect(text).toContain("read it in parts");
    expect(text).toContain("HAR summary: 3 requests");
    expect(text).not.toContain("xxxxxxxxxx");
    expect(text.length).toBeLessThan(1500);
  });

  it("is the text unchanged with no files", () => {
    expect(agentText("hi")).toBe("hi");
    expect(agentText("hi", [])).toBe("hi");
  });

  it("makes document blocks for small PDFs only", () => {
    const pdf = saveAttachment(
      SCOPE,
      "a.pdf",
      Buffer.from("%PDF-1.4 x"),
      "application/pdf"
    );
    const sheet = saveAttachment(SCOPE, "a.csv", Buffer.from("1"), "text/csv");
    const huge = { ...pdf, size: ATTACHMENT_LIMITS.pdfInlineBytes + 1 };
    expect(documentBlocks([sheet, huge])).toEqual([]);
    const [block] = documentBlocks([pdf, sheet]);
    expect(block.source.media_type).toBe("application/pdf");
    expect(Buffer.from(block.source.data, "base64").toString()).toBe(
      "%PDF-1.4 x"
    );
  });

  it("skips a PDF that's gone", () => {
    expect(documentBlocks([{ ...file, mediaType: "application/pdf" }])).toEqual(
      []
    );
  });
});
