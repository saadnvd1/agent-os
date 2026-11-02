import { NextResponse } from "next/server";

export const fail = (error: unknown, status = 400) =>
  NextResponse.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status }
  );

export const text = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v : null;
