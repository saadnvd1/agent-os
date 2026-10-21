import { sessionLinkView } from "@/lib/analyst";
import { run } from "@/lib/analyst/route";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/sessions/:id/analyst - the live pairing this session is in, as
// coder or analyst, or null.
export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  return run(() => ({ link: sessionLinkView(id) }));
}
