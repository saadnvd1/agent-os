import { NextRequest } from "next/server";
import {
  noApprovalsOn,
  recordAutoApproval,
} from "@/lib/approvals/no-approvals";

// The Claude status hook asks here when a terminal Claude wants a tool
// permission. While No approvals mode is on the answer is Claude's own
// "allow" decision; otherwise nothing, and the prompt shows as usual. A
// question isn't a permission and is never answered. Never fails the hook.
export async function POST(request: NextRequest) {
  try {
    if (!noApprovalsOn()) return new Response("");
    const input = (await request.json()) as { tool_name?: unknown };
    const tool = typeof input?.tool_name === "string" ? input.tool_name : "";
    if (!tool || tool === "AskUserQuestion") return new Response("");
    recordAutoApproval({
      source: "terminal",
      sessionId: request.nextUrl.searchParams.get("session") || null,
      subject: `${tool} in a terminal session`,
    });
    return new Response(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PermissionRequest",
          decision: { behavior: "allow" },
        },
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch {
    return new Response("");
  }
}
