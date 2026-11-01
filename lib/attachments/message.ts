import fs from "fs";
import { ATTACHMENT_LIMITS, formatBytes } from "./policy";
import { summaryPath } from "./store";
import type { ChatFile } from "./types";

/**
 * What the agent reads: the message plus where each file is. Every driver
 * gets this, so any agent can open the files with its own tools (a
 * spreadsheet through a script, a docx through pandoc). The chat keeps the
 * plain text and shows the files as chips.
 */
// Over this, the agent is told to read in parts.
const LARGE_BYTES = 1_000_000;
const SUMMARY_CHARS = 3000;

function summaryOf(file: ChatFile): string {
  try {
    return fs
      .readFileSync(summaryPath(file.path), "utf8")
      .slice(0, SUMMARY_CHARS);
  } catch {
    return "";
  }
}

export function agentText(text: string, files?: ChatFile[]): string {
  if (!files?.length) return text;
  const list = files
    .map((f) => {
      const summary = summaryOf(f);
      const large = f.size > LARGE_BYTES ? ", large: read it in parts" : "";
      return (
        `- ${f.path} (${f.mediaType}, ${formatBytes(f.size)}${large})` +
        (summary ? `\n${summary.replace(/^/gm, "  ")}` : "")
      );
    })
    .join("\n");
  return [
    text,
    `Attached files, saved on this machine. They are never pasted into this message; open them with your own tools (grep or head a big one rather than reading it whole):\n${list}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Claude reads a PDF itself, as a document block, when it's small enough. */
export function documentBlocks(files?: ChatFile[]) {
  const out: {
    type: "document";
    title: string;
    source: { type: "base64"; media_type: "application/pdf"; data: string };
  }[] = [];
  for (const f of files ?? []) {
    if (f.mediaType !== "application/pdf") continue;
    if (f.size > ATTACHMENT_LIMITS.pdfInlineBytes) continue;
    try {
      out.push({
        type: "document",
        title: f.name,
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: fs.readFileSync(f.path).toString("base64"),
        },
      });
    } catch {
      // Unreadable: the agent still has the path.
    }
  }
  return out;
}
