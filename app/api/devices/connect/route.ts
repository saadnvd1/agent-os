import os from "os";
import { NextRequest, NextResponse } from "next/server";
import { demoMode } from "@/lib/security/demo";
import { requireLocalTrust } from "@/lib/security/route-guard";
import { networkState } from "@/lib/security/network-state";
import {
  connectTunnelPort,
  readConnect,
  serverPort,
} from "@/lib/connect/config";
import { ApiError } from "@/lib/connect/control-api";
import { cleanLinkCode, linkWithCode } from "@/lib/connect/link";
import { connectStatus } from "@/lib/connect/serve";

let linking = false;

const nameFrom = (raw: unknown) => {
  const name =
    typeof raw === "string"
      ? raw
          .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
          .trim()
          .slice(0, 64)
      : "";
  return name || os.hostname();
};

// POST /api/devices/connect {code, name?} - link this machine with a code
// from runagentos.com, the same way `agent-os connect` does.
export async function POST(request: NextRequest) {
  const refused = requireLocalTrust(request);
  if (refused) return refused;
  if (demoMode())
    return NextResponse.json({ error: "Not in the demo." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as {
    code?: unknown;
    name?: unknown;
  };
  const code = cleanLinkCode(body.code);
  if (!code)
    return NextResponse.json(
      { error: "Paste the code from runagentos.com." },
      { status: 400 }
    );
  if (readConnect().ok)
    return NextResponse.json(
      { error: "This machine is already linked." },
      { status: 409 }
    );
  const port = connectTunnelPort(serverPort());
  if (!port)
    return NextResponse.json(
      { error: "AGENTOS_CONNECT_PORT isn't a usable port" },
      { status: 500 }
    );
  if (linking)
    return NextResponse.json({ error: "Already linking." }, { status: 409 });
  linking = true;
  try {
    await linkWithCode({ code, name: nameFrom(body.name), port });
  } catch (err) {
    if (err instanceof ApiError && err.status >= 400 && err.status < 500)
      return NextResponse.json(
        { error: `That code didn't work: ${err.message}` },
        { status: 400 }
      );
    console.error(`connect: link failed: ${(err as Error).message}`);
    return NextResponse.json(
      { error: "Couldn't link. Check the code and try again." },
      { status: 502 }
    );
  } finally {
    linking = false;
  }
  // The running server picks the new files up within a couple of seconds.
  for (let i = 0; i < 12 && !connectStatus().enrolled; i++)
    await new Promise((r) => setTimeout(r, 250));
  return NextResponse.json(await networkState());
}
