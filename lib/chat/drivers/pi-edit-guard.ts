import { writeEditGuard } from "./edit-guard";

// Pi's edit and write tools, with the edit guard beside them: a doomed edit
// is blocked before it runs (and before the approvals extension asks about
// it), and what a finished edit or write broke comes back in its result.
// Exported for its test.
export const PI_EDIT_GUARD_EXTENSION = String.raw`import {
  FailureLog,
  absolute,
  closestMatch,
  guardEdit,
  readText,
  syntaxReport,
} from "./agentos-edit-guard-lib.mjs";

const log = new FailureLog();
const before = new Map();

function oldTexts(input) {
  let edits = input?.edits;
  if (typeof edits === "string") {
    try {
      edits = JSON.parse(edits);
    } catch {
      edits = null;
    }
  }
  if (Array.isArray(edits)) return edits.map((e) => e?.oldText).filter((t) => typeof t === "string");
  return typeof input?.oldText === "string" ? [input.oldText] : [];
}

const textOf = (content) =>
  (Array.isArray(content) ? content : []).map((c) => (typeof c?.text === "string" ? c.text : "")).join("\n");

export default function (pi) {
  pi.on("tool_call", async (event) => {
    try {
      const tool = event.toolName;
      const input = event.input || {};
      if (typeof input.path !== "string") return;
      const file = absolute(input.path, process.cwd());
      if (tool === "read") return void log.clear(file);
      if (tool !== "edit" && tool !== "write") return;
      if (tool === "edit") {
        const why = guardEdit(log, input.path, oldTexts(input), process.cwd());
        if (why) return { block: true, reason: why };
      }
      before.set(event.toolCallId, readText(file));
    } catch {}
  });

  pi.on("tool_result", async (event) => {
    try {
      const tool = event.toolName;
      const input = event.input || {};
      if ((tool !== "edit" && tool !== "write") || typeof input.path !== "string") return;
      const file = absolute(input.path, process.cwd());
      const prior = before.get(event.toolCallId);
      before.delete(event.toolCallId);
      const content = Array.isArray(event.content) ? event.content : [];
      if (event.isError) {
        const said = textOf(content);
        if (tool !== "edit" || !/could not find|not find/i.test(said)) return;
        const olds = oldTexts(input);
        const named = /edits\[(\d+)\]/.exec(said);
        const old = olds[named ? Number(named[1]) : 0];
        const text = readText(file);
        if (old === undefined || text == null) return;
        const repeat = log.record(file, old);
        const near = closestMatch(text, old);
        const more = [
          repeat >= 2 ? "This is the same edit that has already failed " + (repeat - 1) + " time(s). Do not send it again unchanged." : "",
          near ? "The file's current text near the closest match (lines " + near.from + "-" + near.to + "):\n" + near.excerpt : "",
          "Read " + input.path + " again and build the edit from what is there now.",
        ].filter(Boolean);
        return { content: [...content, { type: "text", text: more.join("\n") }] };
      }
      log.clear(file);
      const report = syntaxReport(input.path, prior, readText(file), process.cwd());
      if (report) return { content: [...content, { type: "text", text: report }] };
    } catch {}
  });
}
`;

export const writePiEditGuard = (folder?: string) =>
  writeEditGuard("agentos-pi-edit-guard.mjs", PI_EDIT_GUARD_EXTENSION, folder);
