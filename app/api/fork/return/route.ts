import { NextRequest, NextResponse } from "next/server";
import { fail, text } from "@/lib/fork/api";
import { returnChild } from "@/lib/fork/settle";

// `aos return`: a fork child hands in its result.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const child = text(body.from);
    if (!child) throw new Error("Only a fork child can return a result");
    const state = await returnChild(
      child,
      String(body.text ?? ""),
      body.failed === true
    );
    return NextResponse.json({ state });
  } catch (error) {
    return fail(error);
  }
}
