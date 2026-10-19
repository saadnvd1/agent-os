import { NextRequest, NextResponse } from "next/server";
import { ReadError, readPeer } from "@/lib/bus/read";

// `aos read <session>`: a peer's conversation in the caller's workspace,
// condensed. Read-only: nothing about the target changes.
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const count = (k: string) => {
    const raw = q.get(k);
    if (raw === null) return undefined;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 5000)
      throw new ReadError(`${k} must be a whole number from 1 to 5000`, 400);
    return n;
  };
  try {
    const from = q.get("from");
    if (!from)
      throw new ReadError("aos read runs from inside an AgentOS session", 400);
    const result = await readPeer(from, q.get("ref") ?? "", {
      turns: count("turns"),
      lines: count("lines"),
      all: q.get("all") === "1",
      grep: q.get("grep") || undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: message },
      { status: error instanceof ReadError ? error.status : 500 }
    );
  }
}
