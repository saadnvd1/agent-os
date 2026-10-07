// The web app's base light and dark themes (styles/themes.css), as RN colors.
export interface Palette {
  background: string;
  card: string;
  raised: string;
  foreground: string;
  muted: string;
  faint: string;
  primary: string;
  onPrimary: string;
  primarySoft: string;
  secondary: string;
  border: string;
  destructive: string;
  destructiveSoft: string;
  success: string;
  warning: string;
  warningSoft: string;
  codeBg: string;
  diffAdd: string;
  diffDel: string;
}

export const light: Palette = {
  background: "hsl(240, 10%, 95.5%)",
  card: "hsl(0, 0%, 100%)",
  raised: "hsl(0, 0%, 100%)",
  foreground: "hsl(240, 12%, 14%)",
  muted: "hsl(240, 6%, 46%)",
  faint: "hsl(240, 6%, 62%)",
  primary: "hsl(262, 83%, 58%)",
  onPrimary: "hsl(0, 0%, 100%)",
  primarySoft: "hsl(252, 40%, 95%)",
  secondary: "hsl(240, 16%, 94%)",
  border: "hsl(240, 14%, 88%)",
  destructive: "hsl(352, 80%, 56%)",
  destructiveSoft: "hsla(352, 80%, 56%, 0.1)",
  success: "hsl(152, 65%, 38%)",
  warning: "hsl(38, 92%, 46%)",
  warningSoft: "hsla(38, 92%, 50%, 0.12)",
  codeBg: "hsl(240, 16%, 96%)",
  diffAdd: "hsla(152, 65%, 40%, 0.12)",
  diffDel: "hsla(352, 80%, 56%, 0.1)",
};

export const dark: Palette = {
  background: "hsl(240, 18%, 3.5%)",
  card: "hsl(240, 14%, 6%)",
  raised: "hsl(240, 14%, 8.5%)",
  foreground: "hsl(240, 10%, 93%)",
  muted: "hsl(240, 6%, 58%)",
  faint: "hsl(240, 6%, 42%)",
  primary: "hsl(262, 92%, 68%)",
  onPrimary: "hsl(0, 0%, 100%)",
  primarySoft: "hsl(250, 18%, 13%)",
  secondary: "hsl(240, 12%, 10%)",
  border: "hsl(240, 10%, 15%)",
  destructive: "hsl(352, 85%, 62%)",
  destructiveSoft: "hsla(352, 85%, 62%, 0.14)",
  success: "hsl(152, 70%, 52%)",
  warning: "hsl(38, 95%, 58%)",
  warningSoft: "hsla(38, 95%, 58%, 0.14)",
  codeBg: "hsl(240, 12%, 8%)",
  diffAdd: "hsla(152, 70%, 52%, 0.14)",
  diffDel: "hsla(352, 85%, 62%, 0.14)",
};
