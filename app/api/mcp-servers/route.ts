import { NextResponse } from "next/server";
import { configuredMcpServers } from "@/lib/orchestrator/mcp-servers";

// The names of the MCP servers configured on this machine, for choosing which
// a workspace's orchestrator may use. Names only.
export async function GET() {
  return NextResponse.json({ servers: configuredMcpServers() });
}
