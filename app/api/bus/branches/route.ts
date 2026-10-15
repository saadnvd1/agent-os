import { NextRequest, NextResponse } from "next/server";
import { getDoneTarget } from "@/lib/done";
import { scopeOf } from "@/lib/done/bulk";
import { prunableRepos } from "@/lib/tasks/prune-scope";
import { pruneRepo, pruneText } from "@/lib/tasks/prune-branches";

// `aos branches prune`, from inside a session: reaches only the caller's
// workspace (or its project when it has none). Lists unless `yes` is true.
export async function POST(request: NextRequest) {
  try {
    const { from = null, yes = false } = await request.json();
    if (typeof from !== "string" || !from)
      throw new Error("aos branches runs from inside an AgentOS session");
    const scope = scopeOf(getDoneTarget(from));
    const repos = await prunableRepos(scope);
    if (!repos.length) throw new Error("No GitHub projects in scope");
    const results = [];
    for (const repo of repos)
      results.push(await pruneRepo(repo, { yes: yes === true }));
    return NextResponse.json({ summary: pruneText(results, yes === true) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
