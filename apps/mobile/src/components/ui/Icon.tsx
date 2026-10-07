import { SymbolView, type SymbolViewProps } from "expo-symbols";

type Props = {
  name: SymbolViewProps["name"];
  size?: number;
  color: string;
  weight?: SymbolViewProps["weight"];
};

export function Icon({ name, size = 20, color, weight = "medium" }: Props) {
  return (
    <SymbolView
      name={name}
      size={size}
      tintColor={color}
      weight={weight}
      // Decorative: the control around it carries the label.
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={{ width: size, height: size }}
    />
  );
}
