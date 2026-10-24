import { NextResponse } from "next/server";
import { modelCatalog, unconfiguredChoices } from "@/lib/models/catalog";

// GET /api/models/choices - every model a picker offers, from the server:
// the enabled providers' models and the ones Pi reaches, each with its
// locality (local or cloud), the last availability check and whether it can
// call tools. Models of a provider that is off, or half set up, are listed
// with `unusable` saying why, so a picker can grey them rather than hide them.
export async function GET() {
  return NextResponse.json({
    choices: [...modelCatalog(), ...unconfiguredChoices()],
  });
}
