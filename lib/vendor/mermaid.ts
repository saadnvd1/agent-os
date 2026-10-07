/**
 * The mermaid bundle the web app already ships, served to the phone app so
 * diagrams render with no third-party fetch (tailnet-only and offline).
 * Read once and kept; the sha256 is its ETag and the app's cache key.
 */
import { createHash } from "crypto";
import { readFile } from "fs/promises";
import { createRequire } from "module";
import path from "path";

export interface VendorAsset {
  body: Buffer;
  version: string;
  sha256: string;
}

let cached: Promise<VendorAsset> | null = null;

export function mermaidAsset(root = process.cwd()): Promise<VendorAsset> {
  cached ??= (async () => {
    const req = createRequire(path.join(root, "package.json"));
    const file = req.resolve("mermaid/dist/mermaid.min.js");
    const pkg = JSON.parse(
      await readFile(req.resolve("mermaid/package.json"), "utf8")
    ) as { version: string };
    const body = await readFile(file);
    return {
      body,
      version: pkg.version,
      sha256: createHash("sha256").update(body).digest("hex"),
    };
  })().catch((err) => {
    cached = null;
    throw err;
  });
  return cached;
}
