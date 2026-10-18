import { NextRequest } from "next/server";
import { finishMcpSignIn } from "@/lib/chat/mcp-auth";

const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] as string
  );

function page(ok: boolean, heading: string, message: string): Response {
  const body = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(heading)}</title><style>:root{color-scheme:light dark}body{font:16px system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;text-align:center}main{max-width:26rem}h1{font-size:1.25rem;margin:0 0 .5rem}p{margin:0;opacity:.75}</style></head><body><main><h1>${escape(heading)}</h1><p>${escape(message)}</p></main></body></html>`;
  return new Response(body, {
    status: ok ? 200 : 400,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

// GET /api/mcp-auth/callback - where an MCP server's sign-in sends the
// browser back to. The address carries a one-time code, so nothing here
// logs or rethrows it.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const failed = params.get("error");
  try {
    if (failed && !params.get("code")) {
      const why = (params.get("error_description") || failed).slice(0, 200);
      await finishMcpSignIn(request.url).catch(() => {});
      return page(
        false,
        "Sign-in wasn't completed",
        `${why}. Press Sign in again in AgentOS.`
      );
    }
    const { server } = await finishMcpSignIn(request.url);
    return page(
      true,
      `Signed in to ${server}`,
      "You can close this tab and go back to AgentOS."
    );
  } catch (error) {
    return page(
      false,
      "Sign-in wasn't completed",
      error instanceof Error ? error.message : "Press Sign in again."
    );
  }
}
