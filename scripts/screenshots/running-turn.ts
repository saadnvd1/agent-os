import type { Page } from "playwright";
import type { Part, Shot } from "./shots";

// A running turn, held on screen by the demo's scripted turn
// (lib/chat/drivers/demo-script): `npm run screenshots -- --only running-turn`.
// Each part sends the trigger for one state and waits for it to show.

const SESSION = "running-turn";
const HOLD_S = 60;

const PHASES = [
  { phase: "step", marker: /npx vitest run src\/checkout/ },
  { phase: "wait", marker: /Waiting for/ },
  { phase: "retry", marker: /Retrying model request/ },
] as const;

async function startTurn(
  page: Page,
  phase: string,
  marker: RegExp,
  phone: boolean
): Promise<void> {
  if (phone) {
    await page.locator("button:has(svg.lucide-menu)").first().click();
    await page.waitForTimeout(800);
  }
  await page.getByText(SESSION, { exact: true }).first().click();
  await page.waitForTimeout(2500);
  await page.locator(".chat-composer [contenteditable]").first().click();
  await page.keyboard.type(`demo: running turn ${phase} hold=${HOLD_S}`);
  // Enter is a new line on a phone: the send button sends.
  if (phone)
    await page.locator("button:has(svg.lucide-arrow-up)").last().click();
  else await page.keyboard.press("Enter");
  await page.getByText(marker).first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
}

const parts = (device: Part["device"]): Part[] =>
  PHASES.map(({ phase, marker }) => ({
    id: `${phase}-${device}`,
    device,
    themes: ["dark", "light"],
    keepFocus: true,
    setup: (page) => startTurn(page, phase, marker, device === "phone"),
  }));

export const RUNNING_TURN_SHOTS: Shot[] = [
  {
    name: "running-turn",
    onDemand: true,
    parts: [...parts("desktop"), ...parts("phone")],
  },
];
