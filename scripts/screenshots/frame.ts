/**
 * Frames raw captures for the README: headline, brand mark, the capture in a
 * rounded window on a soft purple-tinted ground. Writes screenshots/*.png.
 */
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { chromium } from "playwright";
import { OUT, REPO } from "./config";
import type { Raw } from "./shoot";

type Layout = "window" | "fit" | "phones";

interface Caption {
  headline: string;
  subline: string;
  layout: Layout;
}

const CAPTIONS: Record<string, Caption> = {
  hero: {
    headline: "All your agent sessions in one place",
    subline:
      "Chat with an agent, read every step and diff, and see which sessions need you.",
    layout: "window",
  },
  mobile: {
    headline: "Built for your phone",
    subline: "The same sessions on a phone, with a layout made for touch.",
    layout: "phones",
  },
  commands: {
    headline: "Slash commands and skills",
    subline: "Type / in the composer to run a command or one of your skills.",
    layout: "window",
  },
  tasks: {
    headline: "Hand off a task, review the PR",
    subline:
      "Each task works on its own branch and ends as a pull request you sign off.",
    layout: "fit",
  },
  messages: {
    headline: "Sessions can talk to each other",
    subline:
      "Agents coordinate over a shared message bus, and you can join in.",
    layout: "fit",
  },
  orchestrator: {
    headline: "An orchestrator for each workspace",
    subline:
      "It runs tasks, reviews and merges what passes the gates, and asks you about the rest.",
    layout: "window",
  },
  "task-chat": {
    headline: "Tasks end in a pull request",
    subline:
      "Each task works in its own worktree, opens as a chat, and reviews its own PR.",
    layout: "window",
  },
  draft: {
    headline: "Nothing starts until you send",
    subline:
      "A new session or task is a draft: pick the project, machine, agent and branch first.",
    layout: "window",
  },
  machines: {
    headline: "Other machines, same list",
    subline:
      "A linked machine's sessions sit next to yours, and open, rename and finish the same way.",
    layout: "window",
  },
  terminal: {
    headline: "The terminal is always there",
    subline:
      "Every session runs in tmux, so the agent's own interface is one click away.",
    layout: "window",
  },
};

const MAX_BYTES = 600 * 1024;

const dataUri = (file: string) =>
  `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`;

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function html(caption: Caption, images: string[], theme: string): string {
  const template = fs.readFileSync(
    path.join(__dirname, "template.html"),
    "utf8"
  );
  const logo = fs.readFileSync(path.join(REPO, "public", "icon.svg"), "utf8");
  const shots = images
    .map((f) => `<div class="frame"><img src="${dataUri(f)}" /></div>`)
    .join("");
  const vars: Record<string, string> = {
    THEME: theme,
    LAYOUT: caption.layout,
    HEADLINE: escape(caption.headline),
    SUBLINE: escape(caption.subline),
    LOGO: logo,
    SHOTS: shots,
  };
  return template.replace(/__([A-Z]+)__/g, (_, k: string) => vars[k] ?? "");
}

// Palette PNG keeps UI text crisp at a fraction of the size; past the budget,
// fewer colours.
async function compress(png: Buffer, out: string): Promise<number> {
  for (const colours of [256, 192, 128]) {
    const buf = await sharp(png)
      .png({ palette: true, colours, quality: 90, effort: 10 })
      .toBuffer();
    if (buf.length <= MAX_BYTES || colours === 128) {
      fs.writeFileSync(out, buf);
      return buf.length;
    }
  }
  return 0;
}

const themeOf = (file: string) =>
  file.endsWith("-light.png") ? "light" : "dark";

export async function frame(raw: Raw[]): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1600, height: 1000 },
      deviceScaleFactor: 2,
    });
    for (const shot of raw) {
      const caption = CAPTIONS[shot.name];
      if (!caption) continue;
      // One framed image per theme; parts of the same theme share a frame.
      for (const theme of ["dark", "light"]) {
        const files = shot.files.filter((f) => themeOf(f) === theme);
        if (!files.length) continue;
        await page.setContent(html(caption, files, theme), {
          waitUntil: "networkidle",
        });
        await page.evaluate(() => document.fonts.ready);
        const png = await page.screenshot();
        const name = `${shot.name}${theme === "light" ? "-light" : ""}.png`;
        const bytes = await compress(png, path.join(OUT, name));
        console.log(`  screenshots/${name}  ${Math.round(bytes / 1024)} KB`);
      }
    }
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  // Re-frame whatever raw captures are on disk.
  const dir = process.argv[2];
  if (!dir) throw new Error("usage: frame.ts <raw dir>");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".png"));
  const raw = Object.keys(CAPTIONS).map((name) => ({
    name,
    files: files
      .filter((f) => f.startsWith(`${name}-`))
      .map((f) => path.join(dir, f)),
  }));
  frame(raw).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
