// The welcome has its own address: `/?welcome=<step>`, beside `?settings=`
// and `?session=`. `/welcome` redirects here.

export const WELCOME_PARAM = "welcome";

export const WELCOME_STEPS = ["agents", "project", "finish"] as const;

export type WelcomeStep = (typeof WELCOME_STEPS)[number];

export interface WelcomeLocation {
  open: boolean;
  step: WelcomeStep;
}

const BASE = "http://agentos.invalid";

export const isWelcomeStep = (v: unknown): v is WelcomeStep =>
  (WELCOME_STEPS as readonly unknown[]).includes(v);

/** What the address says; a bare or unknown step starts at the first. */
export function welcomeFromHref(href: string): WelcomeLocation {
  const value = new URL(href, BASE).searchParams.get(WELCOME_PARAM);
  if (value === null) return { open: false, step: WELCOME_STEPS[0] };
  return { open: true, step: isWelcomeStep(value) ? value : WELCOME_STEPS[0] };
}

/** The same address with the welcome set (or removed), as path+query+hash. */
export function hrefWithWelcome(href: string, at: WelcomeLocation): string {
  const url = new URL(href, BASE);
  if (at.open) url.searchParams.set(WELCOME_PARAM, at.step);
  else url.searchParams.delete(WELCOME_PARAM);
  return url.pathname + url.search + url.hash;
}
