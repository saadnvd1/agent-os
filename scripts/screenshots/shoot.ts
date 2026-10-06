/**
 * Drives the demo server with Playwright and writes raw PNGs to RAW.
 * Expects a seeded server on BASE_URL (run.ts starts one).
 *
 *     npx tsx scripts/screenshots/shoot.ts [hero,tasks,...]
 */
import fs from "fs";
import path from "path";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import { BASE_URL, RAW, forbiddenStrings } from "./config";
import { SHOTS, type Shot } from "./shots";
import { COMMANDS, MODELS } from "./chat";

export interface Raw {
  name: string;
  files: string[];
}

const DESKTOP = {
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
};
const PHONE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
};

// Dev-mode chrome and focus rings nobody asked to photograph.
const HIDE = `
  nextjs-portal, [data-nextjs-toast], [data-sonner-toaster] { display: none !important; }
  *, *::before, *::after { caret-color: transparent !important; }
`;

// Headless WebGL draws xterm at the wrong pixel ratio; the DOM renderer is
// what a reader would see anyway.
const ARGS = ["--disable-webgl", "--disable-webgl2"];

async function launch(): Promise<Browser> {
  try {
    return await chromium.launch({ channel: "chrome", args: ARGS });
  } catch {
    return chromium.launch({ args: ARGS });
  }
}

async function newPage(
  browser: Browser,
  device: "desktop" | "phone",
  theme: "dark" | "light"
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({
    ...(device === "phone" ? PHONE : DESKTOP),
    colorScheme: theme,
  });
  // next-themes reads localStorage.theme before first paint.
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem("theme", t);
      localStorage.setItem("agentOS-sidebar-pinned", "true");
      localStorage.setItem("terminal-font-size", "15");
    } catch {
      // Storage unavailable; the default theme is dark anyway.
    }
  }, theme);
  // The slash menu lists the demo's commands, not the local agent's skills.
  await ctx.routeWebSocket(/\/ws\/chat/, (ws) => {
    const server = ws.connectToServer();
    server.onMessage((raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.type === "capabilities") {
        Object.assign(msg, {
          commands: COMMANDS,
          models: MODELS,
          model: "opus",
        });
      }
      ws.send(JSON.stringify(msg));
    });
  });
  const page = await ctx.newPage();
  return { ctx, page };
}

async function assertClean(page: Page, label: string): Promise<void> {
  const text = (
    await page.evaluate(() => document.body.innerText + document.title)
  ).toLowerCase();
  const leaks = forbiddenStrings().filter((s) => text.includes(s));
  if (leaks.length) throw new Error(`${label}: page shows ${leaks.join(", ")}`);
  for (const bad of ["stopped", "something went wrong", "failed to"]) {
    if (text.includes(bad)) throw new Error(`${label}: page says "${bad}"`);
  }
}

export async function shoot(only?: string[]): Promise<Raw[]> {
  fs.mkdirSync(RAW, { recursive: true });
  const browser = await launch();
  const results: Raw[] = [];
  try {
    for (const shot of SHOTS.filter((s) => !only || only.includes(s.name))) {
      results.push({ name: shot.name, files: await take(browser, shot) });
    }
  } finally {
    await browser.close();
  }
  return results;
}

async function take(browser: Browser, shot: Shot): Promise<string[]> {
  const files: string[] = [];
  for (const part of shot.parts) {
    for (const theme of part.themes ?? ["dark"]) {
      const { ctx, page } = await newPage(browser, part.device, theme);
      try {
        await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
        await page.addStyleTag({ content: HIDE });
        await page.waitForLoadState("networkidle").catch(() => {});
        await part.setup(page);
        await page.addStyleTag({ content: HIDE });
        if (!part.keepFocus) {
          await page.evaluate(() =>
            (document.activeElement as HTMLElement | null)?.blur?.()
          );
        }
        await page.waitForTimeout(600);
        await assertClean(page, `${shot.name}/${part.id}`);
        const file = path.join(RAW, `${shot.name}-${part.id}-${theme}.png`);
        if (part.clip) {
          await page.locator(part.clip).first().screenshot({ path: file });
        } else {
          await page.screenshot({ path: file });
        }
        files.push(file);
        console.log(`  ${path.basename(file)}`);
      } finally {
        await ctx.close();
      }
    }
  }
  return files;
}

if (require.main === module) {
  shoot(process.argv[2]?.split(",")).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
