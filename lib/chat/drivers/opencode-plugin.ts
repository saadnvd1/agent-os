import { writeEditGuard } from "./edit-guard";

// OpenCode's edit and write tools, with the edit guard beside them as a
// plugin. A throw in tool.execute.before becomes the tool's error, so a
// doomed edit never runs and the model reads why; tool.execute.after adds
// what a finished edit broke to the result. OpenCode runs every export of a
// plugin file as a plugin, so this has exactly one. Exported for its test.
export const OPENCODE_GUARD_PLUGIN = String.raw`import { createHash } from "node:crypto";
import {
  FailureLog,
  absolute,
  failureMessage,
  guardEdit,
  readText,
  syntaxReport,
} from "./agentos-edit-guard-lib.mjs";

const EDITS = new Set(["edit", "multiedit"]);
const hash = (t) => createHash("sha1").update(String(t ?? "")).digest("hex");

function oldTexts(args) {
  if (Array.isArray(args?.edits)) return args.edits.map((e) => e?.oldString).filter((t) => typeof t === "string");
  return typeof args?.oldString === "string" ? [args.oldString] : [];
}

export const AgentOSGuard = async (ctx) => {
  const cwd = ctx?.directory || process.cwd();
  const log = new FailureLog();
  const before = new Map();
  // Edits that passed the check but never reached tool.execute.after: the
  // tool itself failed them.
  const inflight = new Map();
  return {
    "tool.execute.before": async (input, output) => {
      const tool = input?.tool;
      const args = output?.args || {};
      if (!EDITS.has(tool) && tool !== "write") return;
      if (typeof args.filePath !== "string") return;
      const file = absolute(args.filePath, cwd);
      if (EDITS.has(tool)) {
        const why = guardEdit(log, args.filePath, oldTexts(args), cwd);
        if (why) throw new Error(why);
        const old = oldTexts(args)[0];
        const text = readText(file);
        if (tool === "edit" && old !== undefined && text != null) {
          const key = log.key(file, old);
          for (const [id, e] of inflight) {
            if (id === input.callID || e.key !== key || e.hash !== hash(text)) continue;
            inflight.delete(id);
            log.record(file, old);
            throw new Error(failureMessage(args.filePath, old, text, log.record(file, old)));
          }
          inflight.set(input.callID, { key, hash: hash(text) });
        }
      }
      before.set(input.callID, readText(file));
    },
    "tool.execute.after": async (input, output) => {
      try {
        const tool = input?.tool;
        const args = input?.args || {};
        if (!EDITS.has(tool) && tool !== "write") return;
        if (typeof args.filePath !== "string") return;
        const file = absolute(args.filePath, cwd);
        const prior = before.get(input.callID);
        before.delete(input.callID);
        inflight.delete(input.callID);
        log.clear(file);
        const report = syntaxReport(args.filePath, prior, readText(file), cwd);
        if (report && output) output.output = String(output.output ?? "") + "\n\n" + report;
      } catch {}
    },
  };
};
`;

export const writeOpenCodeGuard = (folder?: string) =>
  writeEditGuard("agentos-opencode-guard.mjs", OPENCODE_GUARD_PLUGIN, folder);
