import { proxy, ref } from "valtio";
import { PaletteRegistry, type PaletteCommand } from "@/lib/palette/registry";

// A one-off choice in the palette (which project, which machine), in place
// of its commands. ⌘1-9 picks the first nine.
export interface PalettePicker {
  placeholder: string;
  items: PaletteCommand[];
}

export type PaletteMode = "commands" | "conversations";

export const paletteUi = proxy<{
  open: boolean;
  picker: PalettePicker | null;
  mode: PaletteMode;
  // What was typed when the mode changed, so the other mode starts with it.
  query: string;
}>({ open: false, picker: null, mode: "commands", query: "" });

export const paletteActions = {
  open: () => {
    paletteUi.picker = null;
    paletteUi.mode = "commands";
    paletteUi.query = "";
    paletteUi.open = true;
  },
  setOpen: (open: boolean) => {
    paletteUi.open = open;
    if (!open) {
      paletteUi.picker = null;
      paletteUi.mode = "commands";
      paletteUi.query = "";
    }
  },
  setMode: (mode: PaletteMode, query = "") => {
    paletteUi.picker = null;
    paletteUi.mode = mode;
    paletteUi.query = query;
  },
  pick: (placeholder: string, items: PaletteCommand[]) => {
    paletteUi.mode = "commands";
    paletteUi.picker = ref({
      placeholder,
      items: items.map((c, i) => (i < 9 ? { ...c, hint: `⌘${i + 1}` } : c)),
    });
    paletteUi.open = true;
  },
};

// The one registry every feature adds its commands to.
export const paletteRegistry = new PaletteRegistry();
