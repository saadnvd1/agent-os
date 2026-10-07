import { proxy } from "valtio";
import { PaletteRegistry } from "@/lib/palette/registry";

export const paletteUi = proxy({ open: false });

export const paletteActions = {
  open: () => {
    paletteUi.open = true;
  },
  setOpen: (open: boolean) => {
    paletteUi.open = open;
  },
};

// The one registry every feature adds its commands to.
export const paletteRegistry = new PaletteRegistry();
