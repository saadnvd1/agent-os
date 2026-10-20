// Lets the places where a session ends ask for a look at open waits now,
// without importing the bus. The watcher registers itself here.

let kick: (() => void) | null = null;

export function onKick(fn: () => void): void {
  kick = fn;
}

export function kickWaits(): void {
  kick?.();
}
