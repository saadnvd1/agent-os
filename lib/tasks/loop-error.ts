// A refusal the loop routes turn into a status code.
export class LoopError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409
  ) {
    super(message);
    this.name = "LoopError";
  }
}

/** The task a route names: unknown, not a task, or another machine's. */
export function localTask<T extends { task_status?: string | null }>(
  session: T | undefined,
  mirror: (s: T) => boolean
): T {
  if (!session?.task_status) throw new LoopError("Task not found", 404);
  if (mirror(session))
    throw new LoopError("That task runs on another machine", 409);
  return session;
}
