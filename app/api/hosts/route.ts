import { NextRequest, NextResponse } from "next/server";
import { createHost, listHosts } from "@/lib/hosts";

export async function GET() {
  return NextResponse.json({ hosts: listHosts() });
}

export async function POST(request: NextRequest) {
  try {
    const { name, sshTarget } = await request.json();
    const host = createHost(String(name || ""), String(sshTarget || ""));
    return NextResponse.json({ host }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
