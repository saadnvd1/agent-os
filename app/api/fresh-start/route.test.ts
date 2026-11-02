import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { refreshSettings } from "@/lib/chat/refresh";
import { SETTING_DEFAULTS } from "@/lib/settings/defaults";
import { GET, PATCH } from "./route";

const patch = (body: unknown) =>
  PATCH(
    new NextRequest("http://localhost/api/fresh-start", {
      method: "PATCH",
      body: JSON.stringify(body),
    })
  );

describe("PATCH /api/fresh-start", () => {
  it("changes only the field it's sent", async () => {
    const res = await patch({ compactTokens: 120_000 });
    expect(res.status).toBe(200);
    expect(refreshSettings()).toEqual({
      ...SETTING_DEFAULTS.fresh,
      compactTokens: 120_000,
    });
    expect(await (await GET()).json()).toMatchObject({
      interactiveAutoCompactTokens: 300_000,
    });
  });

  it("rejects an out-of-range value and saves nothing", async () => {
    const res = await patch({ taskTokens: 10_000 });
    expect(res.status).toBe(400);
    expect(refreshSettings().taskTokens).toBe(0);
  });
});
