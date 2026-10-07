import { proxy, ref } from "valtio";
import { PaletteRegistry, type PaletteCommand } from "@/lib/palette/registry";

// A one-off choice in the palette (which project, which machine), in place
// of its commands. ⌘1-9 picks the first nine.
export interface PalettePicker {
  placeholder: string;
  items: PaletteCommand[];
}

export const paletteUi = proxy<{ open: boolean; picker: PalettePicker | null }>(
  { open: false, picker: null }
);

export const paletteActions = {
  open: () => {
    paletteUi.picker = null;
    paletteUi.open = true;
  },
  setOpen: (open: boolean) => {
    paletteUi.open = open;
    if (!open) paletteUi.picker = null;
  },
  pick: (placeholder: string, items: PaletteCommand[]) => {
    paletteUi.picker = ref({
      placeholder,
      items: items.map((c, i) => (i < 9 ? { ...c, hint: `⌘${i + 1}` } : c)),
    });
    paletteUi.open = true;
  },
};

// The one registry every feature adds its commands to.
export const paletteRegistry = new PaletteRegistry();
