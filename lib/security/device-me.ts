import { NextRequest, NextResponse } from "next/server";
import { DEVICE_HEADER } from "./auth";

/**
 * The calling device, from the gate's header (never the body). Null when the
 * request wasn't made with a device token, e.g. from this machine's browser.
 */
export const callingDevice = (request: NextRequest): string | null =>
  request.headers.get(DEVICE_HEADER);

export const needsDevice = () =>
  NextResponse.json({ error: "Needs a paired device token." }, { status: 403 });
