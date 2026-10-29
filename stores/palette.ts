import { proxy, ref } from "valtio";
import {
  PaletteRegistry,
  type PaletteCommand,
  type PaletteTab,
} from "@/lib/palette/registry";

// A one-off choice in the palette (which project, which machine), in place
// of its commands. ⌘1-9 picks the first nine.
export interface PalettePicker {
  placeholder: string;
  items: PaletteCommand[];
}

export const paletteUi = proxy<{
  open: boolean;
  picker: PalettePicker | null;
  tab: PaletteTab;
  // What was typed when the tab changed, so a body that mounts starts with it.
  query: string;
}>({ open: false, picker: null, tab: "all", query: "" });

export const paletteActions = {
  open: () => {
    paletteUi.picker = null;
    paletteUi.tab = "all";
    paletteUi.query = "";
    paletteUi.open = true;
  },
  setOpen: (open: boolean) => {
    paletteUi.open = open;
    if (!open) {
      paletteUi.picker = null;
      paletteUi.tab = "all";
      paletteUi.query = "";
    }
  },
  setTab: (tab: PaletteTab, query = "") => {
    paletteUi.picker = null;
    paletteUi.tab = tab;
    paletteUi.query = query;
  },
  pick: (placeholder: string, items: PaletteCommand[]) => {
    paletteUi.tab = "all";
    paletteUi.picker = ref({
      placeholder,
      items: items.map((c, i) => (i < 9 ? { ...c, hint: `⌘${i + 1}` } : c)),
    });
    paletteUi.open = true;
  },
};

// The one registry every feature adds its commands to.
export const paletteRegistry = new PaletteRegistry();
