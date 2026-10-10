// Settings has its own address: `/?settings=<section>`, or a bare
// `?settings` for the list (a phone) or the first section. It sits beside
// `?session=`, so a link can name both.

export const SETTINGS_PARAM = "settings";

export const SETTINGS_SECTIONS = [
  "merging",
  "workspaces",
  "devices",
  "notifications",
  "schedules",
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export interface SettingsLocation {
  open: boolean;
  // null: the list on a phone, the first section on a wider screen.
  section: SettingsSection | null;
}

const BASE = "http://agentos.invalid";

export const isSettingsSection = (v: unknown): v is SettingsSection =>
  (SETTINGS_SECTIONS as readonly unknown[]).includes(v);

/** What the address says; an unknown section opens Settings at the top. */
export function settingsFromHref(href: string): SettingsLocation {
  const value = new URL(href, BASE).searchParams.get(SETTINGS_PARAM);
  if (value === null) return { open: false, section: null };
  return { open: true, section: isSettingsSection(value) ? value : null };
}

/** The same address with Settings set (or removed), as path+query+hash. */
export function hrefWithSettings(href: string, at: SettingsLocation): string {
  const url = new URL(href, BASE);
  if (at.open) url.searchParams.set(SETTINGS_PARAM, at.section ?? "");
  else url.searchParams.delete(SETTINGS_PARAM);
  // `?settings=` reads as `?settings`.
  const search = url.search.replace(/([?&]settings)=(?=&|$)/, "$1");
  return url.pathname + search + url.hash;
}
