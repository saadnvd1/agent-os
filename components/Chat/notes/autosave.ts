export type SaveState = "idle" | "pending" | "saving" | "saved" | "error";

export interface Autosaver<T> {
  /** The latest value: saved once edits stop for `delay` ms. */
  change(value: T): void;
  /** Saves what is waiting now (blur, close, switching session). */
  flush(): Promise<void>;
}

// One save at a time, always of the newest value: an edit made during a save
// is saved after it, and values passed over in between are never sent.
export function createAutosaver<T>({
  save,
  delay = 1000,
  onState,
}: {
  save: (value: T) => Promise<void>;
  delay?: number;
  onState?: (state: SaveState) => void;
}): Autosaver<T> {
  let waiting: { value: T } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;

  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const run = (): Promise<void> => {
    clear();
    if (running) return running.then(() => (waiting ? run() : undefined));
    if (!waiting) return Promise.resolve();
    const { value } = waiting;
    waiting = null;
    onState?.("saving");
    running = save(value).then(
      () => {
        running = null;
        if (waiting) return run();
        onState?.("saved");
      },
      () => {
        running = null;
        // Kept, so the next edit or flush tries again with the newest value.
        waiting ??= { value };
        onState?.("error");
      }
    );
    return running;
  };

  return {
    change(value) {
      waiting = { value };
      onState?.("pending");
      clear();
      timer = setTimeout(() => void run(), delay);
    },
    flush: run,
  };
}
