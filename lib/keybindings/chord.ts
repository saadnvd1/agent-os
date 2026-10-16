export interface Chord {
  key: string;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const MODS: Record<string, "ctrl" | "meta" | "alt" | "shift"> = {
  ctrl: "ctrl",
  control: "ctrl",
  cmd: "meta",
  meta: "meta",
  alt: "alt",
  option: "alt",
  shift: "shift",
};

const KEY_NAMES: Record<string, string> = {
  esc: "escape",
  space: " ",
  return: "enter",
  up: "arrowup",
  down: "arrowdown",
  left: "arrowleft",
  right: "arrowright",
};

export const isMac = () =>
  typeof navigator !== "undefined" &&
  /mac|iphone|ipad/i.test(navigator.platform);

// "ctrl+b", "shift+tab", "meta+k". Modifiers must match exactly: ctrl+b is
// not cmd+b and not ctrl+shift+b. "mod" is Cmd on a Mac and Ctrl elsewhere.
export function parseChord(keys: string, mac: boolean = isMac()): Chord {
  const chord: Chord = {
    key: "",
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
  };
  for (const raw of keys.toLowerCase().split("+")) {
    const part = raw.trim();
    const mod = part === "mod" ? (mac ? "meta" : "ctrl") : MODS[part];
    if (mod) chord[mod] = true;
    else if (chord.key) throw new Error(`Two keys in chord "${keys}"`);
    else chord.key = KEY_NAMES[part] ?? part;
  }
  if (!chord.key) throw new Error(`No key in chord "${keys}"`);
  return chord;
}

export function matchChord(chord: Chord, e: KeyLike): boolean {
  return (
    e.key.toLowerCase() === chord.key &&
    e.ctrlKey === chord.ctrl &&
    e.metaKey === chord.meta &&
    e.altKey === chord.alt &&
    e.shiftKey === chord.shift
  );
}

// "Ctrl+B" for display (the label users know from Claude Code).
export function formatChord(keys: string): string {
  return keys
    .split("+")
    .map((p) => {
      const t = p.trim();
      return t.length === 1
        ? t.toUpperCase()
        : t[0].toUpperCase() + t.slice(1).toLowerCase();
    })
    .join("+");
}

const SYMBOLS: Record<string, string> = {
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
};

// "mod+up" as a hint: "⌘↑" on a Mac, "Ctrl+↑" elsewhere.
export function chordHint(keys: string, mac: boolean = isMac()): string {
  const parts = keys.split("+").map((p) => p.trim().toLowerCase());
  const label = (p: string) =>
    SYMBOLS[p] ??
    (p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1));
  if (!mac)
    return parts
      .map((p) =>
        p === "mod" || p === "cmd" || p === "meta" ? "Ctrl" : label(p)
      )
      .join("+");
  const sym: Record<string, string> = {
    mod: "⌘",
    cmd: "⌘",
    meta: "⌘",
    ctrl: "⌃",
    alt: "⌥",
    option: "⌥",
    shift: "⇧",
  };
  return parts.map((p) => sym[p] ?? label(p)).join("");
}
