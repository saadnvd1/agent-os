import { disconnect, getStatus } from "@/lib/lumifyhub/connection";
import { respond } from "@/lib/lumifyhub/http";

export async function GET() {
  return respond(() => getStatus());
}

export async function DELETE() {
  return respond(() => {
    disconnect();
    return getStatus();
  });
}
