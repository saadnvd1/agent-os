import { NextResponse } from "next/server";
import { modelCatalog } from "@/lib/models/catalog";

// GET /api/models/choices - every model a picker offers, from the server:
// the enabled providers' models and the ones Pi reaches, each with its
// locality (local or cloud) and the last availability check.
export async function GET() {
  return NextResponse.json({ choices: modelCatalog() });
}
