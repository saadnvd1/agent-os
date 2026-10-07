import { createContext, useContext, type ComponentType } from "react";
import type { TextProps } from "react-native";
import { Text } from "~/components/ui/Text";

// Which Text the inline spans use: inside a selectable prose chunk they
// must be its own kind, so the native view can lay them out as one string.
export const InlineText = createContext<ComponentType<TextProps>>(Text);
export const useInlineText = () => useContext(InlineText);
