import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { agentText, documentBlocks } from "./message";
import { ATTACHMENT_LIMITS, acceptAttr, typeFor } from "./policy";
import { attachmentsRoot, resolveFiles, saveAttachment } from "./store";

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
