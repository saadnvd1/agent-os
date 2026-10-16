import { matchChord, parseChord, type Chord, type KeyLike } from "./chord";

/**
 * Key chords tied to commands. Features register theirs under a source name
 * and take them back the same way; one keydown listener serves them all.
 *
 * To add a shortcut, add one line to the `useKeybindings` call of the
 * feature that owns the action: { id, keys: "ctrl+b", when, run }.
 */
export interface Keybinding {
  id: string;
  // "ctrl+b", "shift+tab", "esc": modifiers must match exactly.
  keys: string;
  // Whether it applies right now. The key is left alone when it doesn't.
  when?: (e: KeyboardEvent) => boolean;
  // Also fire while the key is held down.
  repeat?: boolean;
  run: () => void;
}

interface Compiled {
  binding: Keybinding;
  chord: Chord;
}

export class KeybindingRegistry {
  private sources = new Map<string, Compiled[]>();
  private attached = false;

  constructor(
    private target: Pick<Window, "addEventListener" | "removeEventListener">
  ) {}

  // Replaces what a source binds; returns how to take it back.
  register(source: string, bindings: Keybinding[]): () => void {
    const compiled = bindings.map((binding) => ({
      binding,
      chord: parseChord(binding.keys),
    }));
    this.sources.set(source, compiled);
    this.attach();
    return () => {
      if (this.sources.get(source) !== compiled) return;
      this.sources.delete(source);
      if (!this.sources.size) this.detach();
    };
  }

  // Runs the first binding whose chord matches and whose `when` holds, and
  // reports whether one did (the caller then stops the key).
  handle(e: KeyboardEvent): boolean {
    for (const list of this.sources.values())
      for (const { binding, chord } of list) {
        if (!matchChord(chord, e as KeyLike)) continue;
        if (e.isComposing || (e.repeat && !binding.repeat)) continue;
        if (binding.when && !binding.when(e)) continue;
        e.preventDefault();
        binding.run();
        return true;
      }
    return false;
  }

  private onKey = (e: Event) => {
    this.handle(e as KeyboardEvent);
  };

  private attach() {
    if (this.attached) return;
    this.attached = true;
    this.target.addEventListener("keydown", this.onKey, true);
  }

  private detach() {
    this.attached = false;
    this.target.removeEventListener("keydown", this.onKey, true);
  }
}

export const keybindings = new KeybindingRegistry(
  typeof window === "undefined"
    ? { addEventListener() {}, removeEventListener() {} }
    : window
);
