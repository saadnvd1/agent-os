import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { agentRolesView, saveAgentRoles } from "@/lib/models/agent-roles-view";
import { roleMapSchema } from "@/lib/models/config";
import { getProject } from "@/lib/projects";
import { getWorkspace } from "@/lib/workspaces";
import { requireLocalTrust } from "@/lib/security/route-guard";

const scopeQuery = z.object({
  scope: z.enum(["settings", "workspace", "project"]).default("settings"),
  id: z.string().min(1).optional(),
});

function known({ scope, id }: z.infer<typeof scopeQuery>): string | null {
  if (scope === "settings") return null;
  if (!id) return `${scope} needs an id`;
  if (scope === "workspace" && !getWorkspace(id)) return "Workspace not found";
  if (scope === "project" && !getProject(id)) return "Project not found";
  return null;
}

// GET /api/agent-roles?scope=settings|workspace|project&id= - the four
// agent roles and the internal ones: what's saved at the scope, the model in
// force and where it came from, and the model's locality and availability.
export async function GET(request: NextRequest) {
  const q = scopeQuery.safeParse(
    Object.fromEntries(request.nextUrl.searchParams)
  );
  if (!q.success)
    return NextResponse.json({ error: "Bad scope" }, { status: 400 });
  const missing = known(q.data);
  if (missing) return NextResponse.json({ error: missing }, { status: 404 });
  return NextResponse.json(agentRolesView(q.data));
}

const body = scopeQuery.extend({
  roles: roleMapSchema,
  fallbacks: roleMapSchema.optional(),
});

// PUT /api/agent-roles {scope, id?, roles, fallbacks?} - replaces the roles
// saved at the scope. Only from this machine or the tailnet, like Settings.
export async function PUT(request: NextRequest) {
  const refused = requireLocalTrust(request);
  if (refused) return refused;
  try {
    const b = body.parse(await request.json());
    const missing = known(b);
    if (missing) return NextResponse.json({ error: missing }, { status: 404 });
    saveAgentRoles(b, b.roles, b.fallbacks);
    return NextResponse.json(agentRolesView(b));
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? error.issues.map((i) => i.message).join("; ")
        : error instanceof Error
          ? error.message
          : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
