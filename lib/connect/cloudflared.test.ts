import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import {
  CLOUDFLARED_VERSION,
  ensureCloudflared,
  pinFor,
  type Pin,
} from "./cloudflared";
import { tempDir } from "@/lib/test-temp";

const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");
const tmp = () => tempDir("connect-cfd-");

/** A stand-in for the release: serves `asset`, counting downloads. */
function release(asset: Buffer) {
  const urls: string[] = [];
  const fetchImpl = (async (url: string) => {
    urls.push(String(url));
    return new Response(new Uint8Array(asset));
  }) as unknown as typeof fetch;
  return { fetchImpl, urls };
}

function tgzOf(binary: Buffer): Buffer {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "cloudflared"), binary);
  execFileSync("tar", [
    "-czf",
    path.join(dir, "a.tgz"),
    "-C",
    dir,
    "cloudflared",
  ]);
  return fs.readFileSync(path.join(dir, "a.tgz"));
}

const fakeBinary = () =>
  Buffer.concat([Buffer.from("#!/bin/sh\n"), crypto.randomBytes(256)]);

describe("ensureCloudflared", () => {
  it("pins 2026.10.0 for each supported platform, and nothing else", () => {
    expect(CLOUDFLARED_VERSION).toBe("2026.10.0");
    expect(pinFor("darwin", "arm64")?.assetSha256).toBe(
      "a2f79ff7b9420aa537d74af239f376da170bbabeb529aec416002adac6a72e70"
    );
    expect(pinFor("darwin", "x64")?.assetSha256).toBe(
      "903845b81828c8cb3c5d13d816a2de71c06a3da5785469df8eb0e1b736d92f9f"
    );
    expect(pinFor("darwin", "arm64")?.binarySha256).toBe(
      "72edfd3eea463aef4d5cb89e2e209cecb048cc756c2b01915de2e0ad7cb39830"
    );
    expect(pinFor("darwin", "x64")?.binarySha256).toBe(
      "0560c9ab7281ac3f746055323623ed23bc0405b6dab9400474020cba33a978da"
    );
    expect(pinFor("linux", "x64")?.assetSha256).toBe(
      "d33ff2d14475178d2012c2c56beba87389ac5ded27649519f198a7d3134a99db"
    );
    expect(pinFor("linux", "arm64")?.assetSha256).toBe(
      "e6422b9d4f72d3194bc5a38676f13667c06666523217b842a877d72a80b5ac08"
    );
    expect(pinFor("linux", "x64")?.binarySha256).toBe(
      "d33ff2d14475178d2012c2c56beba87389ac5ded27649519f198a7d3134a99db"
    );
    expect(pinFor("linux", "arm64")?.binarySha256).toBe(
      "e6422b9d4f72d3194bc5a38676f13667c06666523217b842a877d72a80b5ac08"
    );
    expect(pinFor("win32", "x64")).toBeNull();
    expect(pinFor("linux", "ia32")).toBeNull();
  });

  it("downloads into the Connect folder, checks it, then makes it executable once", async () => {
    const binary = fakeBinary();
    const pin: Pin = {
      asset: "cloudflared-linux-amd64",
      assetSha256: sha(binary),
      binarySha256: sha(binary),
    };
    const dir = tmp();
    const r = release(binary);
    const bin = await ensureCloudflared({ dir, pin, fetchImpl: r.fetchImpl });
    expect(bin).toBe(
      path.join(dir, "bin", `cloudflared-${CLOUDFLARED_VERSION}`)
    );
    expect(fs.statSync(bin).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(dir, "bin")).mode & 0o777).toBe(0o700);
    expect(r.urls).toEqual([
      `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-linux-amd64`,
    ]);
    expect(await ensureCloudflared({ dir, pin, fetchImpl: r.fetchImpl })).toBe(
      bin
    );
    expect(r.urls).toHaveLength(1);
    // Only the binary is left behind.
    expect(fs.readdirSync(path.join(dir, "bin"))).toEqual([path.basename(bin)]);
  });

  it("unpacks a .tgz and checks both the archive and the binary inside", async () => {
    const binary = fakeBinary();
    const archive = tgzOf(binary);
    const pin: Pin = {
      asset: "cloudflared-darwin-arm64.tgz",
      assetSha256: sha(archive),
      binarySha256: sha(binary),
    };
    const dir = tmp();
    const bin = await ensureCloudflared({
      dir,
      pin,
      fetchImpl: release(archive).fetchImpl,
    });
    expect(fs.readFileSync(bin).equals(binary)).toBe(true);

    // Right archive hash, wrong binary inside: refused.
    const other = tmp();
    await expect(
      ensureCloudflared({
        dir: other,
        pin: { ...pin, binarySha256: sha(fakeBinary()) },
        fetchImpl: release(archive).fetchImpl,
      })
    ).rejects.toThrow("pinned SHA-256");
    expect(fs.readdirSync(path.join(other, "bin"))).toEqual([]);
  });

  it("never writes or runs a download that doesn't match its pin", async () => {
    const binary = fakeBinary();
    const pin: Pin = {
      asset: "cloudflared-linux-amd64",
      assetSha256: sha(binary),
      binarySha256: sha(binary),
    };
    const dir = tmp();
    await expect(
      ensureCloudflared({
        dir,
        pin,
        fetchImpl: release(fakeBinary()).fetchImpl,
      })
    ).rejects.toThrow("pinned SHA-256");
    expect(fs.readdirSync(path.join(dir, "bin"))).toEqual([]);
  });

  it("replaces a binary that was changed on disk instead of running it", async () => {
    const binary = fakeBinary();
    const pin: Pin = {
      asset: "cloudflared-linux-amd64",
      assetSha256: sha(binary),
      binarySha256: sha(binary),
    };
    const dir = tmp();
    const r = release(binary);
    const bin = await ensureCloudflared({ dir, pin, fetchImpl: r.fetchImpl });
    fs.writeFileSync(bin, "#!/bin/sh\necho swapped\n");
    await ensureCloudflared({ dir, pin, fetchImpl: r.fetchImpl });
    expect(r.urls).toHaveLength(2);
    expect(fs.readFileSync(bin).equals(binary)).toBe(true);
  });

  it("says so on a platform with no pinned build", async () => {
    await expect(ensureCloudflared({ dir: tmp(), pin: null })).rejects.toThrow(
      "isn't available"
    );
  });
});

// Downloads ~160 MB, so it runs only when asked:
// CHECK_CLOUDFLARED_RELEASE=1 npx vitest run lib/connect/cloudflared.test.ts
describe.runIf(process.env.CHECK_CLOUDFLARED_RELEASE === "1")(
  "the real 2026.10.0 release",
  () => {
    for (const [platform, arch] of [
      ["darwin", "arm64"],
      ["darwin", "x64"],
      ["linux", "x64"],
      ["linux", "arm64"],
    ]) {
      it(`matches every pinned hash for ${platform}-${arch}`, async () => {
        const pin = pinFor(platform, arch)!;
        const bin = await ensureCloudflared({ dir: tmp(), pin });
        expect(sha(fs.readFileSync(bin))).toBe(pin.binarySha256);
      }, 300_000);
    }
  }
);
