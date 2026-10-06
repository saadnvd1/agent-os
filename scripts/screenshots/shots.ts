import type { Page } from "playwright";

// Each shot is one or more raw captures; frame.ts composes them.
export interface Part {
  id: string;
  device: "desktop" | "phone";
  themes?: ("dark" | "light")[];
  // Capture only this element instead of the viewport.
  clip?: string;
  // Leave focus where setup put it (an open menu closes on blur).
  keepFocus?: boolean;
  setup: (page: Page) => Promise<void>;
}

export interface Shot {
  name: string;
  parts: Part[];
}

const CHAT = "checkout-totals";

async function openSession(page: Page, name: string): Promise<void> {
  await page.getByText(name, { exact: true }).first().click();
  await page.waitForTimeout(2500);
}

async function openSessionOnPhone(page: Page, name: string): Promise<void> {
  await page.locator("button:has(svg.lucide-menu)").first().click();
  await page.waitForTimeout(800);
  await openSession(page, name);
}

async function closeGitDrawer(page: Page): Promise<void> {
  const header = page.locator("div.px-3.py-2", { hasText: "Git Changes" });
  if (await header.count()) {
    await header.first().locator("button").last().click();
    await page.waitForTimeout(500);
  }
}

// Open the turn's second run of steps (the edits) and bring it into view.
async function showEdits(page: Page): Promise<void> {
  await page.getByText(/steps · 2 edits/).click();
  await page.waitForTimeout(500);
  await page.getByText(/^Found it\./).evaluate((el) => {
    el.scrollIntoView({ block: "start" });
    const scroller = el.closest(".overflow-y-auto");
    if (scroller) scroller.scrollTop -= 20;
  });
  await page.waitForTimeout(300);
}

async function openDialog(page: Page, button: RegExp): Promise<void> {
  await openSession(page, CHAT);
  await page.getByRole("button", { name: button }).click();
  await page.waitForTimeout(2500);
}

export const SHOTS: Shot[] = [
  {
    name: "hero",
    parts: [
      {
        id: "desktop",
        device: "desktop",
        themes: ["dark", "light"],
        setup: async (page) => {
          await openSession(page, CHAT);
          await showEdits(page);
        },
      },
    ],
  },
  {
    name: "mobile",
    parts: [
      {
        id: "chat",
        device: "phone",
        setup: async (page) => {
          await openSessionOnPhone(page, CHAT);
        },
      },
      {
        id: "sidebar",
        device: "phone",
        setup: async (page) => {
          await openSessionOnPhone(page, CHAT);
          await page.locator("button:has(svg.lucide-menu)").first().click();
          await page.waitForTimeout(1200);
        },
      },
    ],
  },
  {
    name: "commands",
    parts: [
      {
        id: "desktop",
        device: "desktop",
        keepFocus: true,
        setup: async (page) => {
          await openSession(page, CHAT);
          await closeGitDrawer(page);
          await page.getByPlaceholder(`Message ${CHAT}`).click();
          await page.keyboard.type("/");
          await page.waitForTimeout(1200);
        },
      },
    ],
  },
  {
    name: "tasks",
    parts: [
      {
        id: "dialog",
        device: "desktop",
        clip: "[role=dialog]",
        setup: (page) => openDialog(page, /Tasks/),
      },
    ],
  },
  {
    name: "messages",
    parts: [
      {
        id: "dialog",
        device: "desktop",
        clip: "[role=dialog]",
        setup: (page) => openDialog(page, /Messages/),
      },
    ],
  },
  {
    name: "terminal",
    parts: [
      {
        id: "desktop",
        device: "desktop",
        setup: async (page) => {
          await openSession(page, "webhook-retries");
          await closeGitDrawer(page);
          await page.waitForTimeout(2000);
        },
      },
    ],
  },
];
