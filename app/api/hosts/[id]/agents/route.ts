import { NextResponse } from "next/server";
import { machineCatalog } from "@/lib/machines/catalog";
import { hostCatalog } from "@/lib/machines/remote";
import { getHost, isRemoteHost } from "@/lib/hosts";
import type { HostCatalogResponse } from "@/lib/machines/types";

export const dynamic = "force-dynamic";

// The agents and models a machine reports, for the new-session form: this
// machine's own, or a linked machine's through its AgentOS. ?project= adds
// what that project last ran with.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!getHost(id))
    return NextResponse.json({ error: "Unknown machine" }, { status: 404 });
  const project = new URL(request.url).searchParams.get("project") || null;
  const body: HostCatalogResponse = isRemoteHost(id)
    ? await hostCatalog(id, project)
    : { catalog: await machineCatalog(project), error: null };
  return NextResponse.json(body);
}
