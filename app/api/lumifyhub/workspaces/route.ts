import { respond } from "@/lib/lumifyhub/http";
import { listLhWorkspaces } from "@/lib/lumifyhub/links";

export async function GET() {
  return respond(async () => ({ workspaces: await listLhWorkspaces() }));
}
