// Done merges, stops the agent and cleans up; any step can stall on a lock or
// a slow remote. A request must always end: past this it answers that it is
// still going, rather than leaving the row on "Merging…".
export const DONE_DEADLINE_MS = 150_000;

export async function withinDeadline<T>(
  work: Promise<T>,
  name: string,
  ms = DONE_DEADLINE_MS
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `Done on ${name} is taking longer than ${Math.round(ms / 1000)}s and is still running in the background. Check the row in a moment; if it hasn't moved, try Done again.`
          )
        ),
      ms
    );
  });
  // The work keeps going; its late failure must not be an unhandled rejection.
  work.catch(() => {});
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

// Best-effort: waits for `work` up to `ms`, then carries on without it.
export async function withTimeout(
  work: Promise<unknown>,
  ms: number
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  work.catch(() => {});
  await Promise.race([
    work,
    new Promise((resolve) => {
      timer = setTimeout(resolve, ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
