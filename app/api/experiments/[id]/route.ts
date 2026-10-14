import { NextRequest, NextResponse } from "next/server";
import { experimentsLocked, setExperiment } from "@/lib/experiments";
import { isExperimentId } from "@/lib/experiments/registry";
import { usageDetail } from "@/lib/experiments/meter";
import { experimentView } from "@/lib/experiments/view";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/experiments/:id - the experiment with its per-day usage
export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  if (!isExperimentId(id))
    return NextResponse.json({ error: "Unknown experiment" }, { status: 404 });
  return NextResponse.json({
    ...experimentView(id),
    locked: experimentsLocked(),
    detail: usageDetail(id),
  });
}

// PUT /api/experiments/:id {on} - anyone using the app may switch one
export async function PUT(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  if (!isExperimentId(id))
    return NextResponse.json({ error: "Unknown experiment" }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { on?: unknown };
  if (typeof body.on !== "boolean")
    return NextResponse.json(
      { error: "on must be true or false" },
      { status: 400 }
    );
  if (experimentsLocked())
    return NextResponse.json(
      { error: "Experiments are switched off for this server" },
      { status: 409 }
    );
  setExperiment(id, body.on);
  return NextResponse.json(experimentView(id));
}
