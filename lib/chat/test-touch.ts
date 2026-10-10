// For tests of file watching.

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Makes a change, and again every 2s until it's seen: macOS can be slow, and
// drops an event while another watcher in the process opens or closes.
// Returns how many times it changed things.
export async function touchUntil(touch: () => void, seen: () => boolean) {
  for (let n = 1; n <= 15; n++) {
    touch();
    for (let t = 0; t < 100; t++) {
      if (seen()) return n;
      await sleep(20);
    }
  }
  throw new Error("never seen");
}
