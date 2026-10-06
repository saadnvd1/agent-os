import { respond } from "@/lib/lumifyhub/http";
import { boardTodos } from "@/lib/lumifyhub/task-cards";

// Each linked board's To Do cards that no task has taken yet.
export async function GET() {
  return respond(async () => ({ boards: await boardTodos() }));
}
