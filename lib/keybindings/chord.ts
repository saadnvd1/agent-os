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
};

// "ctrl+b", "shift+tab", "meta+k". Modifiers must match exactly: ctrl+b is
// not cmd+b and not ctrl+shift+b.
export function parseChord(keys: string): Chord {
  const chord: Chord = {
    key: "",
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
  };
  for (const raw of keys.toLowerCase().split("+")) {
    const part = raw.trim();
    const mod = MODS[part];
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
