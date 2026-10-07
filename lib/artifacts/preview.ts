/**
 * Renders a page in headless Chrome and returns what an agent needs to check
 * its own work: a PNG, the height the page wants, and its console.
 */

import { findChrome, launchChrome, type Browser } from "./chrome";
import { startPublicProxy } from "./public-proxy";
import { prepareArtifact } from "./serve";

export interface ConsoleMessage {
  level: "log" | "info" | "warning" | "error";
  text: string;
}

export interface PreviewResult {
  png: string; // base64
  width: number;
  contentHeight: number;
  capturedHeight: number;
  console: ConsoleMessage[];
}

// The page loads from this made-up origin, served from memory, never from a
// file; `.localhost` keeps it a secure context that may load http resources.
const PAGE_ORIGIN = "http://agentos-preview.localhost/";
const PAGE_URL = `${PAGE_ORIGIN}page.html`;
const VIEWPORT_HEIGHT = 800;
const MAX_CAPTURE_HEIGHT = 4000;
const MAX_CONSOLE = 30;
const MAX_CONSOLE_TEXT = 500;
const LOAD_TIMEOUT_MS = 15_000;

const LEVELS: Record<string, ConsoleMessage["level"]> = {
  log: "log",
  debug: "log",
  table: "log",
  trace: "log",
  info: "info",
  warning: "warning",
  error: "error",
  assert: "error",
};

type RemoteObject = { type: string; value?: unknown; description?: string };
const text = (o: RemoteObject) =>
  typeof o.value === "string"
    ? o.value
    : (o.description ?? (o.value === undefined ? o.type : String(o.value)));

export function consoleMessage(
  method: string,
  params: unknown
): ConsoleMessage | undefined {
  if (method === "Runtime.consoleAPICalled") {
    const e = params as { type: string; args: RemoteObject[] };
    const level = LEVELS[e.type];
    return level ? { level, text: e.args.map(text).join(" ") } : undefined;
  }
  if (method === "Runtime.exceptionThrown") {
    const d = (
      params as { exceptionDetails: { text: string; exception?: RemoteObject } }
    ).exceptionDetails;
    return { level: "error", text: d.exception?.description ?? d.text };
  }
  if (method === "Log.entryAdded") {
    const e = (
      params as { entry: { level: string; text: string; url?: string } }
    ).entry;
    return e.level === "error" || e.level === "warning"
      ? { level: e.level, text: e.url ? `${e.text} ${e.url}` : e.text }
      : undefined;
  }
  return undefined;
}

const SETTLE =
  "document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))))";
const MEASURE =
  "(() => { const d = document.documentElement; return Math.ceil(d.scrollHeight > d.clientHeight ? d.scrollHeight : d.getBoundingClientRect().height); })()";

async function render(
  browser: Browser,
  html: string,
  width: number,
  dark: boolean
): Promise<PreviewResult> {
  const { targetId } = await browser.send<{ targetId: string }>(
    "Target.createTarget",
    { url: "about:blank" }
  );
  const { sessionId: sid } = await browser.send<{ sessionId: string }>(
    "Target.attachToTarget",
    { targetId, flatten: true }
  );
  const messages: ConsoleMessage[] = [];
  let omitted = 0;
  let loaded: () => void = () => {};
  const load = new Promise<void>((r) => (loaded = r));
  // As the chat serves it, so the preview matches what the reader sees.
  const body = Buffer.from(prepareArtifact(html), "utf8").toString("base64");

  browser.on((method, params, sessionId) => {
    if (sessionId !== sid) return;
    if (method === "Page.loadEventFired") return loaded();
    if (method === "Fetch.requestPaused") {
      const e = params as {
        requestId: string;
        request: { url: string };
        resourceType?: string;
      };
      const url = e.request.url;
      const fail = () =>
        browser.send(
          "Fetch.failRequest",
          { requestId: e.requestId, errorReason: "BlockedByClient" },
          sid
        );
      // The page itself, from memory. The frame never navigates elsewhere,
      // and nothing but http(s) leaves the browser.
      if (url === PAGE_URL)
        return void browser
          .send(
            "Fetch.fulfillRequest",
            {
              requestId: e.requestId,
              responseCode: 200,
              responseHeaders: [
                { name: "Content-Type", value: "text/html; charset=utf-8" },
              ],
              body,
            },
            sid
          )
          .catch(() => {});
      // Anything else on the page's own origin (a favicon) is empty.
      if (url.startsWith(PAGE_ORIGIN))
        return void browser
          .send(
            "Fetch.fulfillRequest",
            { requestId: e.requestId, responseCode: 204 },
            sid
          )
          .catch(() => {});
      if (e.resourceType === "Document" || !/^https?:/i.test(url))
        return void fail().catch(() => {});
      return void browser
        .send("Fetch.continueRequest", { requestId: e.requestId }, sid)
        .catch(() => {});
    }
    const m = consoleMessage(method, params);
    if (!m) return;
    if (messages.length >= MAX_CONSOLE) return void omitted++;
    messages.push({ ...m, text: m.text.slice(0, MAX_CONSOLE_TEXT) });
  });

  await Promise.all([
    browser.send("Page.enable", {}, sid),
    browser.send("Runtime.enable", {}, sid),
    browser.send("Log.enable", {}, sid),
    browser.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] }, sid),
    browser.send(
      "Emulation.setDeviceMetricsOverride",
      {
        width,
        height: VIEWPORT_HEIGHT,
        deviceScaleFactor: 1,
        mobile: false,
      },
      sid
    ),
    browser.send(
      "Emulation.setEmulatedMedia",
      {
        features: [
          { name: "prefers-color-scheme", value: dark ? "dark" : "light" },
        ],
      },
      sid
    ),
  ]);
  const nav = await browser.send<{ errorText?: string }>(
    "Page.navigate",
    { url: PAGE_URL },
    sid
  );
  if (nav.errorText) throw new Error(`the page did not load: ${nav.errorText}`);
  const timedOut = await Promise.race([
    load.then(() => false),
    new Promise<boolean>((r) => setTimeout(() => r(true), LOAD_TIMEOUT_MS)),
  ]);
  if (timedOut)
    messages.push({
      level: "warning",
      text: `The page took over ${LOAD_TIMEOUT_MS / 1000}s to load; captured as it was.`,
    });
  await browser
    .send(
      "Runtime.evaluate",
      { expression: SETTLE, awaitPromise: true, timeout: 5000 },
      sid
    )
    .catch(() => {});
  const measured = await browser.send<{ result: { value?: number } }>(
    "Runtime.evaluate",
    { expression: MEASURE, returnByValue: true },
    sid
  );
  const contentHeight = Math.max(1, Number(measured.result.value) || 1);
  const capturedHeight = Math.min(contentHeight, MAX_CAPTURE_HEIGHT);
  const shot = await browser.send<{ data: string }>(
    "Page.captureScreenshot",
    {
      format: "png",
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height: capturedHeight, scale: 1 },
    },
    sid
  );
  if (omitted)
    messages.push({
      level: "info",
      text: `${omitted} more console messages omitted.`,
    });
  return {
    png: shot.data,
    width,
    contentHeight,
    capturedHeight,
    console: messages,
  };
}

export async function previewHtml(
  html: string,
  opts: { width?: number; appearance?: "light" | "dark" } = {}
): Promise<PreviewResult> {
  const executable = findChrome();
  if (!executable)
    throw new Error(
      "No Chrome, Chromium, Brave or Edge found for previews. Install one, or set AGENTOS_CHROME to its path."
    );
  const width = Math.min(1600, Math.max(240, Math.round(opts.width ?? 720)));
  const proxy = await startPublicProxy();
  let browser: Browser | undefined;
  try {
    browser = await launchChrome(executable, proxy.port);
    const b = browser;
    return await Promise.race([
      render(b, html, width, opts.appearance !== "light"),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("the preview timed out")), 40_000)
      ),
    ]);
  } finally {
    browser?.close();
    await proxy.close();
  }
}
