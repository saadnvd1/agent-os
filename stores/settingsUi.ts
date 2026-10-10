import { proxy } from "valtio";
import type { SettingsSection } from "@/lib/settings-url";

export type { SettingsSection } from "@/lib/settings-url";

// The one Settings dialog, and the section it shows.
export const settingsUi = proxy<{
  open: boolean;
  section: SettingsSection | null;
}>({ open: false, section: null });

export const settingsUiActions = {
  open: (section: SettingsSection | null = null) => {
    settingsUi.section = section;
    settingsUi.open = true;
  },
  show: (section: SettingsSection | null) => {
    settingsUi.section = section;
  },
  close: () => {
    settingsUi.open = false;
  },
};
