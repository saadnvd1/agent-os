import { useColorScheme } from "react-native";
import { dark, light, type Palette } from "./colors";

export type { Palette };

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };
export const font = {
  mono: "Menlo",
  size: { xs: 12, sm: 13, md: 15, lg: 17, xl: 20, title: 28 },
};
// Apple's minimum touch target.
export const HIT = 44;

export function useTheme(): Palette & { scheme: "light" | "dark" } {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return { ...(scheme === "dark" ? dark : light), scheme };
}
