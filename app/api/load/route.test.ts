import { describe, expect, it, vi } from "vitest";

const facts = vi.hoisted(() => ({ level: null as string | null }));
vi.mock("@/lib/load/machines", () => ({
  localFacts: () => ({
    level: facts.level,
    load1: 1,
    cores: 8,
    memUsedPct: 40,
    booted: 0,
    capabilities: ["linux"],
  }),
}));

import { GET } from "./route";
import { parseReading } from "@/lib/hosts/peer-load";

describe("GET /api/load", () => {
  it("reports no level before the first sample, and the asker reads that as no reading", async () => {
    facts.level = null;
    const body = await GET().json();
    expect(body.level).toBeNull();
    expect(parseReading(body, 1)).toBeNull();
  });

  it("reports the level once it has one", async () => {
    facts.level = "amber";
    const body = await GET().json();
    expect(body).toMatchObject({ level: "amber", cores: 8 });
    expect(parseReading(body, 1)).toMatchObject({ level: "amber" });
  });
});
