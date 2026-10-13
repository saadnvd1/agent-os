import { NextResponse } from "next/server";
import { SimulatorError } from "./index";

// A simulator call's failure as a response: its own errors carry their status.
export function simulatorFailure(error: unknown) {
  if (error instanceof SimulatorError)
    return NextResponse.json(
      { error: error.message },
      { status: error.status }
    );
  console.error("[simulator]", error);
  return NextResponse.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status: 500 }
  );
}
