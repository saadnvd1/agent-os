// Text and TextInput in the web app's fonts (Geist, Geist Mono). A custom
// font on iOS is one family per weight, so the weight picks the face.
import { forwardRef } from "react";
import {
  StyleSheet,
  Text as RNText,
  TextInput as RNTextInput,
  type TextInputProps,
  type TextProps,
  type TextStyle,
} from "react-native";
import { UITextView as UIText } from "@bsky.app/react-native-uitextview";
import { font } from "~/lib/theme";

const SANS: Record<string, string> = {
  "400": "Geist_400Regular",
  "500": "Geist_500Medium",
  "600": "Geist_600SemiBold",
  "700": "Geist_700Bold",
};
const MONO: Record<string, string> = {
  "400": "GeistMono_400Regular",
  "500": "GeistMono_500Medium",
  "600": "GeistMono_600SemiBold",
  "700": "GeistMono_700Bold",
};

function weightOf(w: TextStyle["fontWeight"]): string {
  if (w === "bold") return "700";
  const n = Number(w ?? 400);
  return n >= 700 ? "700" : n >= 600 ? "600" : n >= 500 ? "500" : "400";
}

// A nested Text that only sets a colour inherits its parent's face; one that
// sets a size, weight or family gets its own.
export function withFont(style: TextProps["style"]): TextProps["style"] {
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  if (
    flat.fontSize === undefined &&
    flat.fontWeight === undefined &&
    flat.fontFamily === undefined
  )
    return style;
  const mono = flat.fontFamily === font.mono;
  const { fontWeight, fontStyle, ...rest } = flat;
  // Only the regular italics are loaded: emphasis and code comments use them.
  if (mono && fontStyle === "italic")
    return { ...rest, fontFamily: "GeistMono_400Regular_Italic" };
  return {
    ...rest,
    fontStyle,
    fontFamily: (mono ? MONO : SANS)[weightOf(fontWeight)],
  };
}

export const Text = forwardRef<RNText, TextProps>(function Text(
  { style, ...rest },
  ref
) {
  return <RNText ref={ref} style={withFont(style)} {...rest} />;
});

export const TextInput = forwardRef<RNTextInput, TextInputProps>(
  function TextInput({ style, ...rest }, ref) {
    return <RNTextInput ref={ref} style={withFont(style)} {...rest} />;
  }
);

// Native UITextView text on iOS: a selection can start and end anywhere,
// across paragraphs, with the system Copy, Look Up, Translate and Share.
// Spans nested in it must be SelectableText too.
export function SelectableText({ style, ...rest }: TextProps) {
  return <UIText selectable uiTextView style={withFont(style)} {...rest} />;
}
