import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

interface NpmRegistryResponse {
  version: string;
}

let cachedLatest: { version: string; fetchedAt: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCurrentVersion(): string {
  const pkgPath = join(process.cwd(), "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  return pkg.version;
}

async function getLatestVersion(): Promise<string | null> {
  if (cachedLatest && Date.now() - cachedLatest.fetchedAt < CACHE_TTL) {
    return cachedLatest.version;
  }

  try {
    const res = await fetch(
      "https://registry.npmjs.org/@saadnvd1/agent-os/latest",
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return cachedLatest?.version ?? null;

    const data = (await res.json()) as NpmRegistryResponse;
    cachedLatest = { version: data.version, fetchedAt: Date.now() };
    return data.version;
  } catch {
    return cachedLatest?.version ?? null;
  }
}

function isNewer(latest: string, current: string): boolean {
  const [lMajor, lMinor, lPatch] = latest.split(".").map(Number);
  const [cMajor, cMinor, cPatch] = current.split(".").map(Number);
  if (lMajor !== cMajor) return lMajor > cMajor;
  if (lMinor !== cMinor) return lMinor > cMinor;
  return lPatch > cPatch;
}

export async function GET() {
  const current = getCurrentVersion();
  const latest = await getLatestVersion();

  return NextResponse.json({
    current,
    latest,
    updateAvailable: latest ? isNewer(latest, current) : false,
  });
}
