import { NextRequest, NextResponse } from "next/server";
import { getDb, queries, type Session } from "@/lib/db";
import { hostExec, isRemoteHost } from "@/lib/hosts";
import { shellQuote } from "@/lib/hosts/ssh";
import { appendFileSync } from "fs";
import { pasteText, tmux } from "@/lib/tmux/exec";

// Log to file for debugging
const LOG_FILE = "/tmp/agent-os-send-keys.log";
function log(msg: string) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${msg}\n`;
  console.log(`[send-keys] ${msg}`);
  try {
    appendFileSync(LOG_FILE, line);
  } catch {}
}

// POST /api/sessions/[id]/send-keys - Send text to a tmux session
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { text, pressEnter = true } = body;

    log(`=== START send-keys for session ${id} ===`);
    log(`Text length: ${text?.length || 0}, pressEnter: ${pressEnter}`);

    if (!text || typeof text !== "string") {
      log("ERROR: No text provided");
      return NextResponse.json({ error: "No text provided" }, { status: 400 });
    }

    const db = getDb();
    const session = queries.getSession(db).get(id) as Session | undefined;

    if (!session) {
      log(`ERROR: Session ${id} not found in DB`);
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const tmuxSessionName = session.tmux_name || `${session.agent_type}-${id}`;
    log(`Tmux session name: ${tmuxSessionName}`);

    // A temp file here isn't visible to tmux on another machine, so remote
    // sessions get the text as literal keys instead of a pasted buffer.
    if (isRemoteHost(session.host_id)) {
      const target = shellQuote(`=${tmuxSessionName}:`);
      try {
        await hostExec(
          session.host_id,
          `tmux send-keys -t ${target} -l ${shellQuote(text)}` +
            (pressEnter ? ` && tmux send-keys -t ${target} Enter` : "")
        );
        return NextResponse.json({ success: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return NextResponse.json({ error: message }, { status: 400 });
      }
    }

    const target = `=${tmuxSessionName}:`;

    // Check if tmux session exists
    try {
      await tmux(["has-session", "-t", `=${tmuxSessionName}`]);
      log(`Tmux session exists`);
    } catch {
      log(`ERROR: Tmux session ${tmuxSessionName} not running`);
      return NextResponse.json(
        { error: "Tmux session not running" },
        { status: 400 }
      );
    }

    try {
      // A named buffer per session avoids races between sends.
      log(`Pasting ${text.length} bytes to ${tmuxSessionName}`);
      await pasteText(target, text, `send-${id}`);

      if (pressEnter) {
        log(`Sending Enter to ${tmuxSessionName}`);
        await tmux(["send-keys", "-t", target, "Enter"]);
      }

      log(`=== SUCCESS ===`);
      return NextResponse.json({ success: true });
    } catch (cmdError) {
      const msg =
        cmdError instanceof Error ? cmdError.message : String(cmdError);
      log(`ERROR in commands: ${msg}`);
      throw cmdError;
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log(`ERROR: ${msg}`);
    console.error("Error sending keys:", error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
