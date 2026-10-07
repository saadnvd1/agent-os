/**
 * html_preview and html_render: every chat agent's way to show a visual. An
 * in-process MCP server in its chat worker, so a render is saved and shown
 * in the conversation before the tool answers.
 */

import fs from "fs";
import path from "path";
import { z } from "zod";
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import {
  createArtifact,
  MAX_HTML_BYTES,
  MAX_TITLE_CHARS,
  type Artifact,
} from "./store";
import { previewHtml } from "./preview";

export const VISUALS_SERVER = "visuals";

export const MIN_FRAME_HEIGHT = 120;
export const MAX_FRAME_HEIGHT = 1200;

type CallToolResult = Awaited<ReturnType<Parameters<typeof tool>[3]>>;

const PAGE_RULES =
  "Pass a complete self-contained HTML document as `html`, or `path` to an .html file. Inline <style> and <script>; a chart library from a CDN (https) is fine. Support light and dark with @media (prefers-color-scheme: dark): the frame follows the reader's theme. Images go in as data: URIs or https URLs; local files and this machine's network are unreachable.";

const source = {
  html: z
    .string()
    .min(1)
    .max(MAX_HTML_BYTES)
    .optional()
    .describe("A complete, self-contained HTML document."),
  path: z
    .string()
    .min(1)
    .optional()
    .describe(
      "An HTML file to use instead, absolute or relative to your working directory."
    ),
};

// The page's HTML, from the call or from a file.
export function readSource(
  args: { html?: string; path?: string },
  cwd: string
): string {
  if (!!args.html === !!args.path)
    throw new Error("Pass either `html` or `path`, not both or neither.");
  if (args.html) return args.html;
  const file = path.resolve(
    cwd,
    args.path!.replace(/^~(?=$|\/)/, process.env.HOME ?? "~")
  );
  const stat = fs.statSync(file, { throwIfNoEntry: false });
  if (!stat?.isFile()) throw new Error(`No file at ${file}`);
  if (stat.size > MAX_HTML_BYTES) throw new Error("The file is over 2 MB.");
  return fs.readFileSync(file, "utf8");
}

const fail = (error: unknown): CallToolResult => ({
  content: [
    {
      type: "text",
      text: error instanceof Error ? error.message : String(error),
    },
  ],
  isError: true,
});

export interface VisualsContext {
  sessionId: string;
  cwd: string;
  // Shows a saved page in the conversation.
  onRender: (artifact: Artifact, height?: number) => void;
}

// Saves the page and shows it in the conversation.
export async function renderPage(
  ctx: VisualsContext,
  args: { html?: string; path?: string; title: string; height?: number }
): Promise<CallToolResult> {
  try {
    const artifact = createArtifact(
      ctx.sessionId,
      args.title,
      readSource(args, ctx.cwd)
    );
    ctx.onRender(artifact, args.height);
    return {
      content: [
        {
          type: "text",
          text: `Shown in the chat as "${artifact.title}" (artifact ${artifact.id}).`,
        },
      ],
    };
  } catch (error) {
    return fail(error);
  }
}

export function visualsTools(
  ctx: VisualsContext
): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: VISUALS_SERVER,
    version: "1.0.0",
    tools: [
      tool(
        "html_preview",
        `Render an HTML page in a headless browser and get back a PNG screenshot, contentHeight (the height the page needs at this width), and its console output (logs, warnings, errors, uncaught exceptions). Use it to check and fix a page before html_render; console.log is a fine way to report your own checks. ${PAGE_RULES}`,
        {
          ...source,
          width: z
            .number()
            .int()
            .min(240)
            .max(1600)
            .optional()
            .describe(
              "Viewport width in CSS pixels. Defaults to 720, the chat column; use 390 to check phones."
            ),
          appearance: z
            .enum(["light", "dark"])
            .optional()
            .describe("Theme to preview. Defaults to dark."),
        },
        async (args) => {
          try {
            const r = await previewHtml(readSource(args, ctx.cwd), args);
            const summary = {
              width: r.width,
              contentHeight: r.contentHeight,
              capturedHeight: r.capturedHeight,
              console: r.console,
            };
            return {
              content: [
                { type: "image", data: r.png, mimeType: "image/png" },
                { type: "text", text: JSON.stringify(summary, null, 1) },
              ],
            };
          } catch (error) {
            return fail(error);
          }
        }
      ),
      tool(
        "html_render",
        `Show a finished HTML page (chart, table, diagram, mockup) inline in this chat, saved so it survives reloads. Call it before your final reply; the reader sees the page above that reply, so don't restate it. Check it with html_preview first. ${PAGE_RULES}`,
        {
          ...source,
          title: z
            .string()
            .min(1)
            .max(MAX_TITLE_CHARS)
            .describe("Short name for the page."),
          height: z
            .number()
            .int()
            .min(MIN_FRAME_HEIGHT)
            .max(MAX_FRAME_HEIGHT)
            .optional()
            .describe(
              "Cap on the frame's height in CSS pixels; longer pages scroll inside it. Defaults to fitting the page."
            ),
        },
        (args) => renderPage(ctx, args)
      ),
    ],
  });
}

export const VISUALS_BRIEF = `## Showing visuals

When a chart, table, diagram or mockup would say more than prose, build a self-contained HTML page (a chart is an HTML page; a CDN library such as Chart.js is fine), check it with \`html_preview\` and fix what the screenshot and console show, then show it with \`html_render\` before your final reply. The reader sees the page above that reply, so add only what the page doesn't say. An SVG or image file you write shows inline when your reply links to it by its absolute path, as ![name](/abs/path.svg).`;
