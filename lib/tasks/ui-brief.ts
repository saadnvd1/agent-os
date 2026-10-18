// The browser-check section of a task's brief, ported from dispatch's
// browser_brief. A project's files decide whether a task gets it, not the
// prompt: the PRs that skipped a check were ones whose prompt never said UI.

import * as fs from "fs";
import * as path from "path";
import { viewportsOf } from "../project-config";
import type { ProjectConfig } from "../project-config";

export type UiKind = "web" | "simulator";

const WEB_DEPS = [
  "react",
  "next",
  "vue",
  "nuxt",
  "svelte",
  "@sveltejs/kit",
  "astro",
  "solid-js",
  "preact",
  "@angular/core",
];
const NATIVE_DEPS = ["react-native", "expo"];

function deps(cwd: string): Set<string> {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(cwd, "package.json"), "utf8")
    );
    return new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ]);
  } catch {
    return new Set();
  }
}

function isRailsApp(cwd: string): boolean {
  try {
    return (
      /^\s*gem\s+["']rails["']/m.test(
        fs.readFileSync(path.join(cwd, "Gemfile"), "utf8")
      ) && fs.statSync(path.join(cwd, "app", "views")).isDirectory()
    );
  } catch {
    return false;
  }
}

// Deterministic and cheap: the config, then two small file reads.
export function uiKindOf(cwd: string, config: ProjectConfig): UiKind | null {
  if (config.browse?.verify === false) return null;
  if (config.simulator) return "simulator";
  if (config.browse) return "web";
  const have = deps(cwd);
  if (NATIVE_DEPS.some((d) => have.has(d))) return null;
  if (WEB_DEPS.some((d) => have.has(d)) || isRailsApp(cwd)) return "web";
  return null;
}

export const SCREENSHOT_DIR = ".agentos/screenshots";

export function uiVerifyBrief(
  kind: UiKind | null,
  browse?: ProjectConfig["browse"]
): string {
  if (!kind) return "";
  if (kind === "simulator")
    return `## Checking UI changes

If your diff changes what a user sees, check the changed screens in the iOS simulator, as "Running this project" describes, before calling it done. Fix anything visibly off. Add a **Simulator check** section to the PR body: the screens you checked, what you looked for, and the screenshot names. If you didn't check, say why in one line.`;
  const sizes = viewportsOf(browse).join(" and ");
  return `## Checking UI changes

If your diff changes what a user sees, run the app and look at every changed screen in a real browser before calling it done, at ${sizes} (\`resize_page\` between them). Do it cheaply:

- The browser is the **\`chrome-devtools\`** MCP server. Load \`mcp__chrome-devtools__new_page\`, \`navigate_page\`, \`resize_page\`, \`take_snapshot\`, \`take_screenshot\` and \`evaluate_script\` with ToolSearch. Don't load or call \`mcp__claude-in-chrome__*\`: it isn't configured here and its first call hangs for 30 seconds. If no \`chrome-devtools\` server is available, say so in the PR and describe what you checked instead.
- Log in and go to pages by URL, from the login, pages and map under "Running this project" when they are there. Exploring the UI to find a page is the most expensive thing a session does.
- One snapshot to find a uid, then act. Verify with a screenshot of the one element or a small \`evaluate_script\` returning the one value you need, not another full snapshot.
- Verify the thing that would be wrong, not the thing that is easy to see: a page that rendered proves it rendered. Fix anything visibly off (gaps, clipping, overlap, horizontal scroll, stray bands, misalignment; measure rects with \`evaluate_script\` and report numbers) and read the console for errors.
- Save screenshots of the final changed screens with \`filePath\` under \`${SCREENSHOT_DIR}/\`, after \`mkdir -p ${SCREENSHOT_DIR} && printf '*\\n' > .agentos/.gitignore\`. That folder is inside the browser's allowed root and git ignores it; a path in /tmp is refused. AgentOS keeps these files after the worktree is removed.
- Add a **Browser check** section to the PR body: the pages and widths you checked, what you fixed, and the screenshot file names (names only, never a worktree path: the worktree is removed when the task ends). If you didn't check (no visible change, or no browser), say why in one line.`;
}
