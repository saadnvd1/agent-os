import { NextRequest, NextResponse } from "next/server";
import {
  openSimulator,
  releaseSimulator,
  simulatorStatus,
} from "@/lib/simulator";
import { simulatorFailure } from "@/lib/simulator/http";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/sessions/[id]/simulator - the task's simulator: state and latest shots
export async function GET(_request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return NextResponse.json(simulatorStatus(id));
}

// POST - start it in the background (`aos sim open`); poll GET
export async function POST(_request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    return NextResponse.json(openSimulator(id), { status: 202 });
  } catch (error) {
    return simulatorFailure(error);
  }
}

// DELETE - end it (`aos sim close`): shut down and removed
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  await releaseSimulator(id, { remove: true });
  return NextResponse.json(simulatorStatus(id));
}
