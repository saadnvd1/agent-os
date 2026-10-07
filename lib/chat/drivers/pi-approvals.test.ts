import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EXTENSION } from "./pi-approvals";

type Handler = (
  event: { toolName: string; input: unknown; toolCallId: string },
  ctx: { ui: { confirm: (t: string, m: string) => Promise<boolean> } }
) => Promise<{ block: true; reason: string } | undefined>;

let dir: string;
let handler: Handler;

// The extension exactly as Pi loads it, with Pi's side stubbed.
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ext-"));
  const file = path.join(dir, "ext.mjs");
  fs.writeFileSync(file, EXTENSION);
  const ext = (await import(pathToFileURL(file).href)) as {
    default: (pi: { on: (e: string, h: Handler) => void }) => void;
  };
  ext.default({ on: (_e, h) => (handler = h) });
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

async function call(
  tool: string,
  access: string | null,
  answer = true,
  input: unknown = { command: "rm x" }
) {
  const accessFile = path.join(dir, "access");
  fs.rmSync(accessFile, { force: true });
  if (access !== null) fs.writeFileSync(accessFile, access);
  process.env.AGENTOS_PI_ACCESS_FILE = accessFile;
  let asked = false;
  const result = await handler(
    { toolName: tool, input, toolCallId: "c1" },
    {
      ui: {
        confirm: async (title) => {
          asked = title === "agentos:c1";
          return answer;
        },
      },
    }
  );
  return { asked, blocked: !!result?.block };
}

describe("Pi approval extension", () => {
  it("asks before bash when the access file is missing or unknown", async () => {
    expect(await call("bash", null)).toEqual({ asked: true, blocked: false });
    expect(await call("bash", "garbage")).toEqual({
      asked: true,
      blocked: false,
    });
  });

  it("blocks the tool when the reader declines", async () => {
    expect(await call("bash", "ask", false)).toEqual({
      asked: true,
      blocked: true,
    });
  });

  it("lets edits through under 'edits', and everything under 'full'", async () => {
    const own = { path: "lib/some-file.ts" };
    expect(await call("edit", "edits", true, own)).toEqual({
      asked: false,
      blocked: false,
    });
    expect(await call("bash", "edits")).toMatchObject({ asked: true });
    expect(await call("bash", "full")).toEqual({
      asked: false,
      blocked: false,
    });
  });

  it("asks before an edit outside the folder, or of its own access file", async () => {
    expect(
      await call("write", "edits", true, { path: "/etc/hosts" })
    ).toMatchObject({
      asked: true,
    });
    expect(
      await call("write", "edits", true, { path: path.join(dir, "access") })
    ).toMatchObject({ asked: true });
    expect(
      await call("write", "edits", true, { path: ".pi/extensions/x.ts" })
    ).toMatchObject({ asked: true });
  });

  // macOS matches names in any case: ACCESS is the same file as access.
  it.runIf(process.platform === "darwin")(
    "asks before writing its access file under another case",
    async () => {
      const inCwd = fs.mkdtempSync(path.join(process.cwd(), ".pi-gate-"));
      try {
        const accessFile = path.join(inCwd, "access");
        fs.writeFileSync(accessFile, "edits");
        process.env.AGENTOS_PI_ACCESS_FILE = accessFile;
        let asked = false;
        await handler(
          {
            toolName: "write",
            input: {
              path: path.join(
                process.cwd(),
                path.basename(inCwd).toUpperCase(),
                "ACCESS"
              ),
            },
            toolCallId: "c1",
          },
          { ui: { confirm: async () => (asked = true) } }
        );
        expect(asked).toBe(true);
      } finally {
        fs.rmSync(inCwd, { recursive: true, force: true });
      }
    }
  );

  it("never asks to read", async () => {
    expect(await call("read", "ask")).toEqual({ asked: false, blocked: false });
  });
});
