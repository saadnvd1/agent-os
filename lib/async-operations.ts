/**
 * Background operation runner for long-running tasks that shouldn't block UI
 *
 * Pattern:
 * 1. Perform fast DB operations immediately
 * 2. Return success to client
 * 3. Run cleanup/slow operations in background
 * 4. Log errors but don't fail the response
 */

type BackgroundTask = () => Promise<void>;

/**
 * Run a task in the background without blocking the response.
 * Errors are logged but don't affect the caller.
 */
export function runInBackground(task: BackgroundTask, taskName: string): void {
  // Fire and forget - don't await
  task().catch((error) => {
    console.error(`[Background Task: ${taskName}] Error:`, error);
  });
}

/**
 * Run multiple tasks in parallel in the background.
 * All tasks run concurrently for speed.
 */
export function runManyInBackground(
  tasks: BackgroundTask[],
  taskName: string
): void {
  Promise.all(tasks.map((task) => task())).catch((error) => {
    console.error(`[Background Tasks: ${taskName}] Error:`, error);
  });
}
