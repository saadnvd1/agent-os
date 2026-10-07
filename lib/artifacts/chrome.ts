/**
 * Headless Chrome, spoken to over the DevTools protocol on a pipe (fd 3 in,
 * fd 4 out, NUL-delimited JSON). Each launch gets a fresh, empty profile, so
 * the page never sees AgentOS cookies, and all its traffic goes through the
 * public-only proxy.
 */

import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import type { Readable, Writable } from "stream";
import { StringDecoder } from "string_decoder";

const MAC_APPS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
];
const PATH_NAMES = [
  "google-chrome",
  "google-chrome-stable",
  "chromium",
  "chromium-browser",
  "chrome",
  "brave-browser",
  "microsoft-edge",
];

// Playwright's downloaded headless shell, when there's no browser installed.
function playwrightShell(): string | undefined {
  const cache =
    process.env.PLAYWRIGHT_BROWSERS_PATH ||
    (process.platform === "darwin"
      ? path.join(os.homedir(), "Library", "Caches", "ms-playwright")
      : path.join(os.homedir(), ".cache", "ms-playwright"));
  let dirs: string[] = [];
  try {
    dirs = fs.readdirSync(cache).filter((d) => d.startsWith("chromium"));
  } catch {
    return undefined;
  }
  for (const dir of dirs.sort().reverse()) {
    for (const rel of [
      "chrome-headless-shell-mac-arm64/chrome-headless-shell",
      "chrome-headless-shell-mac-x64/chrome-headless-shell",
      "chrome-headless-shell-linux64/chrome-headless-shell",
      "chrome-linux/chrome",
    ]) {
      const file = path.join(cache, dir, rel);
      if (fs.existsSync(file)) return file;
    }
  }
  return undefined;
}

export function findChrome(): string | undefined {
  const configured = process.env.AGENTOS_CHROME;
  if (configured) return fs.existsSync(configured) ? configured : undefined;
  if (process.platform === "darwin")
    for (const app of MAC_APPS) if (fs.existsSync(app)) return app;
  for (const dir of (process.env.PATH ?? "").split(path.delimiter))
    for (const name of PATH_NAMES) {
      const file = path.join(dir, name);
      if (dir && fs.existsSync(file)) return file;
    }
  return playwrightShell();
}

const START_TIMEOUT_MS = 15_000;

type Listener = (method: string, params: unknown, sessionId?: string) => void;

export interface Browser {
  send<T = unknown>(
    method: string,
    params?: object,
    sessionId?: string
  ): Promise<T>;
  on(listener: Listener): void;
  close(): void;
}

export function launchChrome(
  executable: string,
  proxyPort: number,
  startTimeoutMs = START_TIMEOUT_MS
): Promise<Browser> {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-preview-"));
  const child: ChildProcess = spawn(
    executable,
    [
      "--headless=new",
      "--remote-debugging-pipe",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--disable-extensions",
      "--disable-sync",
      "--disable-background-networking",
      "--hide-scrollbars",
      "--mute-audio",
      "--block-new-web-contents",
      `--proxy-server=socks5://127.0.0.1:${proxyPort}`,
      // Loopback would otherwise skip the proxy.
      "--proxy-bypass-list=<-loopback>",
      // WebRTC would otherwise send UDP, which no proxy carries.
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
      ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []),
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"], detached: true }
  );
  const input = child.stdio[3] as Writable;
  const output = child.stdio[4] as Readable;
  let stderr = "";
  child.stderr?.on("data", (d: Buffer) => {
    stderr = (stderr + d.toString()).slice(-2000);
  });

  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  const listeners: Listener[] = [];
  let exited: Error | null = null;
  let buffer = "";
  const decoder = new StringDecoder("utf8");
  output.on("data", (chunk: Buffer) => {
    buffer += decoder.write(chunk);
    let at: number;
    while ((at = buffer.indexOf("\0")) !== -1) {
      const raw = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      let m: {
        id?: number;
        method?: string;
        params?: unknown;
        result?: unknown;
        sessionId?: string;
        error?: { message: string };
      };
      try {
        m = JSON.parse(raw);
      } catch {
        continue;
      }
      if (m.id !== undefined) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        if (m.error) p?.reject(new Error(m.error.message));
        else p?.resolve(m.result);
      } else if (m.method) {
        for (const l of listeners) l(m.method, m.params, m.sessionId);
      }
    }
  });
  input.on("error", () => {});

  const cleanup = () => {
    fs.rmSync(profile, { recursive: true, force: true });
  };
  child.on("exit", () => {
    exited = new Error(
      `the browser exited${stderr ? `: ${stderr.trim().split("\n").at(-1)}` : ""}`
    );
    for (const p of pending.values()) p.reject(exited);
    pending.clear();
    cleanup();
  });

  const browser: Browser = {
    send<T>(method: string, params: object = {}, sessionId?: string) {
      if (exited) return Promise.reject(exited);
      const id = nextId++;
      return new Promise<T>((resolve, reject) => {
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
        input.write(
          `${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`
        );
      });
    },
    on(listener) {
      listeners.push(listener);
    },
    close() {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    },
  };

  return new Promise((resolve, reject) => {
    child.once("error", (e) => {
      cleanup();
      reject(e);
    });
    // Ready once it answers; one that never does is killed, not waited on.
    const timer = setTimeout(() => {
      browser.close();
      reject(
        new Error(`the browser did not start within ${startTimeoutMs / 1000}s`)
      );
    }, startTimeoutMs);
    browser.send("Browser.getVersion").then(
      () => {
        clearTimeout(timer);
        resolve(browser);
      },
      (e) => {
        clearTimeout(timer);
        browser.close();
        reject(e);
      }
    );
  });
}
