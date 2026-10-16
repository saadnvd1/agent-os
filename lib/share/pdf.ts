/**
 * The share page as a PDF, printed by headless Chromium from the exact HTML
 * the preview shows. One browser is launched lazily, reused, and closed after
 * a quiet spell. Nothing on the page can reach the network: only the inlined
 * markup is rendered.
 */

import fs from "fs";
import type { Browser, LaunchOptions } from "playwright";

const IDLE_MS = 60_000;
const RENDER_MS = 30_000;

const CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

/** Print-only rules, added here so the HTML download stays as it was. */
const PRINT_CSS = `
@page{margin:16mm 14mm}
html,body{background:#fff!important}
.wrap{max-width:none;padding:0}
*{-webkit-print-color-adjust:exact;print-color-adjust:exact}
pre code,pre,details.tool pre{white-space:pre-wrap!important;word-break:break-word!important;overflow-wrap:anywhere;overflow:visible;max-height:none}
table{display:table;width:100%;table-layout:auto;overflow-wrap:anywhere}
pre,table,tr,.plan,.error,details.tool{break-inside:avoid-page}
h1,h2,h3,h4{break-after:avoid}
img{max-width:100%;break-inside:avoid}
`;

let found: LaunchOptions | null | undefined;

/** How to launch a browser on this machine, or null when there is none. */
export async function findBrowser(): Promise<LaunchOptions | null> {
  if (found !== undefined) return found;
  const { chromium } = await import("playwright");
  const candidates = [chromium.executablePath(), ...CHROME_PATHS];
  const path = candidates.find((p) => p && fs.existsSync(p));
  found = path ? { executablePath: path, headless: true } : null;
  return found;
}

export const pdfAvailable = async () => (await findBrowser()) !== null;

/** Test hook: forget the cached lookup and any open browser. */
export async function resetPdfBrowser() {
  found = undefined;
  await closeBrowser();
}

let browser: Promise<Browser> | null = null;
let idle: NodeJS.Timeout | null = null;

async function closeBrowser() {
  if (idle) clearTimeout(idle);
  idle = null;
  const b = browser;
  browser = null;
  if (b) await (await b).close().catch(() => {});
}

async function getBrowser(): Promise<Browser> {
  const opts = await findBrowser();
  if (!opts) throw new Error("No browser to print with on this machine.");
  if (!browser) {
    const { chromium } = await import("playwright");
    const launched = chromium.launch(opts);
    browser = launched;
    launched.then(
      (b) =>
        b.on("disconnected", () => browser === launched && (browser = null)),
      () => {
        if (browser === launched) browser = null;
      }
    );
  }
  return browser;
}

const withPrint = (html: string) =>
  html.includes("</head>")
    ? html.replace("</head>", () => `<style>${PRINT_CSS}</style></head>`)
    : `<style>${PRINT_CSS}</style>${html}`;

/** The page printed to an A4 PDF. */
export async function renderPdf(html: string): Promise<Buffer> {
  const b = await getBrowser();
  if (idle) clearTimeout(idle);
  const ctx = await b.newContext({
    javaScriptEnabled: false,
    colorScheme: "light",
  });
  try {
    await ctx.setOffline(true);
    const page = await ctx.newPage();
    page.setDefaultTimeout(RENDER_MS);
    await page.emulateMedia({ media: "print", colorScheme: "light" });
    // "load" waits for images and fonts; scripts are off, so nothing runs after.
    await page.setContent(withPrint(html), { waitUntil: "load" });
    return Buffer.from(
      await page.pdf({
        format: "A4",
        printBackground: true,
        preferCSSPageSize: true,
      })
    );
  } finally {
    await ctx.close().catch(() => {});
    idle = setTimeout(() => void closeBrowser(), IDLE_MS);
    idle.unref();
  }
}
