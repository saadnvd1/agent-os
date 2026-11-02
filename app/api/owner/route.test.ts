import { describe, expect, it } from "vitest";
import { GET, PUT } from "./route";

const put = (body: unknown) =>
  PUT(
    new Request("http://localhost/api/owner", {
      method: "PUT",
      body: JSON.stringify(body),
    })
  );

describe("/api/owner", () => {
  it("sets, reads and clears the owner's name", async () => {
    expect(await (await GET()).json()).toEqual({ name: null });
    expect(await (await put({ name: " Alex " })).json()).toEqual({
      name: "Alex",
    });
    expect(await (await GET()).json()).toEqual({ name: "Alex" });
    expect(await (await put({ name: null })).json()).toEqual({ name: null });
    expect(await (await GET()).json()).toEqual({ name: null });
  });

  it("refuses a name that isn't text", async () => {
    expect((await put({ name: 5 })).status).toBe(400);
    expect((await put({})).status).toBe(400);
  });
});
