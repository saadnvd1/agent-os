import { NextResponse } from "next/server";
import { machineCatalog } from "@/lib/machines/catalog";
import { hostCatalog } from "@/lib/machines/remote";
import { getHost, isRemoteHost } from "@/lib/hosts";
import type { HostCatalogResponse } from "@/lib/machines/types";

export const dynamic = "force-dynamic";

// The agents and models a machine reports, for the new-session form: this
// machine's own, or a linked machine's through its AgentOS.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!getHost(id))
    return NextResponse.json({ error: "Unknown machine" }, { status: 404 });
  const body: HostCatalogResponse = isRemoteHost(id)
    ? await hostCatalog(id)
    : { catalog: await machineCatalog(), error: null };
  return NextResponse.json(body);
}
