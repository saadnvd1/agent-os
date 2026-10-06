import { NextRequest, NextResponse } from "next/server";
import { getHost, hostExec } from "@/lib/hosts";

// Confirms ssh works non-interactively and tmux is installed on the machine.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!getHost(id)) {
    return NextResponse.json({ error: "Unknown machine" }, { status: 404 });
  }
  try {
    const { stdout } = await hostExec(
      id,
      `printf '%s\\n' "$(hostname)"; tmux -V 2>/dev/null || echo "no tmux"`,
      10000
    );
    const [hostname, tmux] = stdout.trim().split("\n");
    if (!tmux || tmux === "no tmux") {
      return NextResponse.json({
        ok: false,
        hostname,
        error: "Connected, but tmux is not installed there",
      });
    }
    return NextResponse.json({ ok: true, hostname, tmux });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message.split("\n")[0] });
  }
}
