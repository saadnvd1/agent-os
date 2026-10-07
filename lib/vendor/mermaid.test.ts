import { createHash } from "crypto";
import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { mermaidAsset } from "./mermaid";

describe("mermaidAsset", () => {
  it("is the installed mermaid bundle, with its version and hash", async () => {
    const asset = await mermaidAsset();
    const pkg = JSON.parse(
      readFileSync("node_modules/mermaid/package.json", "utf8")
    );
    expect(asset.version).toBe(pkg.version);
    expect(
      asset.body.equals(
        readFileSync("node_modules/mermaid/dist/mermaid.min.js")
      )
    ).toBe(true);
    expect(asset.sha256).toBe(
      createHash("sha256").update(asset.body).digest("hex")
    );
  });

  it("reads the file once", async () => {
    expect(await mermaidAsset()).toBe(await mermaidAsset());
  });
});
