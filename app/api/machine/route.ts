import { NextResponse } from "next/server";
import { thisMachineReport } from "@/lib/machines/report";

export const dynamic = "force-dynamic";

// This machine's name, OS, addresses, agents and models. A linked machine
// asks for it (it is on the peer allowlist) to fill the new-session form;
// ?project= adds what that project last ran with.
export async function GET(request: Request) {
  const project = new URL(request.url).searchParams.get("project");
  return NextResponse.json(await thisMachineReport(project || null));
}
