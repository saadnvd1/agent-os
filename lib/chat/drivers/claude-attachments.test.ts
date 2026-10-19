import fs from "fs";
import path from "path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { agentText } from "@/lib/attachments/message";
import {
  saveAttachment,
  removeSessionAttachments,
} from "@/lib/attachments/store";

const calls = vi.hoisted(() => ({
  prompt: null as AsyncIterable<{
    message: { content: { type: string; text?: string }[] };
  }> | null,
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  getSessionMessages: vi.fn(),
  query: ({ prompt }: { prompt: typeof calls.prompt }) => {
    calls.prompt = prompt;
    return {
      interrupt: async () => {},
      close: () => {},
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: () =>
        new Promise(() => {}),
      [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }),
    };
  },
}));

const { claudeDriver } = await import("./claude");

const SCOPE = "test-claude-attachments";
afterAll(() => removeSessionAttachments(SCOPE));

// What the driver hands the model for one send.
async function sendWith(
  text: string,
  files: ReturnType<typeof saveAttachment>[]
) {
  const c = claudeDriver.start({
    cwd: "/tmp",
    model: "sonnet",
    access: "full",
    env: {},
  });
  c.send(agentText(text, files), undefined, { files });
  const next = await calls.prompt![Symbol.asyncIterator]().next();
  c.close();
  return next.value.message.content as { type: string; text?: string }[];
}

describe("claude driver and attached files", () => {
  it("sends a PDF as a document block and keeps its path in the text", async () => {
    const pdf = saveAttachment(
      SCOPE,
      "paper.pdf",
      Buffer.from("%PDF-1.4 body"),
      "application/pdf"
    );
    const content = await sendWith("read this", [pdf]);
    expect(content.map((b) => b.type)).toEqual(["document", "text"]);
    expect(content[0]).toMatchObject({
      title: "paper.pdf",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: Buffer.from("%PDF-1.4 body").toString("base64"),
      },
    });
    expect(content[1].text).toContain(pdf.path);
  });

  it("sends any other file as its path in the text, no content block", async () => {
    const xlsx = saveAttachment(
      SCOPE,
      "q3.xlsx",
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    const content = await sendWith("sum column B", [xlsx]);
    expect(content.map((b) => b.type)).toEqual(["text"]);
    expect(content[0].text).toContain("sum column B");
    expect(content[0].text).toContain(xlsx.path);
    expect(path.isAbsolute(xlsx.path)).toBe(true);
    expect(fs.existsSync(xlsx.path)).toBe(true);
  });

  it("falls back to the path when a PDF can't be read", async () => {
    const pdf = saveAttachment(
      SCOPE,
      "gone.pdf",
      Buffer.from("%PDF-1.4"),
      "application/pdf"
    );
    fs.rmSync(pdf.path);
    const content = await sendWith("hi", [pdf]);
    expect(content.map((b) => b.type)).toEqual(["text"]);
    expect(content[0].text).toContain(pdf.path);
  });
});
