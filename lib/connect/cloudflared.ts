/**
 * The cloudflared that carries Connect's tunnel: one pinned release,
 * downloaded into ~/.agent-os/connect/bin and checked against its SHA-256
 * before it is ever made executable or run. Never one from PATH.
 */

import crypto from "crypto";
import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

export const CLOUDFLARED_VERSION = "2026.10.0";

export interface Pin {
  asset: string;
  /** SHA-256 of the release asset as downloaded. */
  assetSha256: string;
  /** SHA-256 of the cloudflared binary (the asset itself unless it's a .tgz). */
  binarySha256: string;
}

// From the release's asset digests, checked by downloading each one; the
// darwin binaries' hashes are of the file inside each .tgz.
const PINS: Record<string, Pin> = {
  "darwin-arm64": {
    asset: "cloudflared-darwin-arm64.tgz",
    assetSha256:
      "a2f79ff7b9420aa537d74af239f376da170bbabeb529aec416002adac6a72e70",
    binarySha256:
      "72edfd3eea463aef4d5cb89e2e209cecb048cc756c2b01915de2e0ad7cb39830",
  },
  "darwin-x64": {
    asset: "cloudflared-darwin-amd64.tgz",
    assetSha256:
      "903845b81828c8cb3c5d13d816a2de71c06a3da5785469df8eb0e1b736d92f9f",
    binarySha256:
      "0560c9ab7281ac3f746055323623ed23bc0405b6dab9400474020cba33a978da",
  },
  "linux-x64": {
    asset: "cloudflared-linux-amd64",
    assetSha256:
      "d33ff2d14475178d2012c2c56beba87389ac5ded27649519f198a7d3134a99db",
    binarySha256:
      "d33ff2d14475178d2012c2c56beba87389ac5ded27649519f198a7d3134a99db",
  },
  "linux-arm64": {
    asset: "cloudflared-linux-arm64",
    assetSha256:
      "e6422b9d4f72d3194bc5a38676f13667c06666523217b842a877d72a80b5ac08",
    binarySha256:
      "e6422b9d4f72d3194bc5a38676f13667c06666523217b842a877d72a80b5ac08",
  },
};

export function pinFor(
  platform: string = process.platform,
  arch: string = os.arch()
): Pin | null {
  return PINS[`${platform}-${arch}`] ?? null;
}

const RELEASES = "https://github.com/cloudflare/cloudflared/releases/download";
// The real assets are ~40 MB; nothing legitimate comes near this.
const MAX_BYTES = 150 * 1024 * 1024;

const sha256 = (data: Buffer) =>
  crypto.createHash("sha256").update(data).digest("hex");

function sha256File(file: string): string | null {
  try {
    return sha256(fs.readFileSync(file));
  } catch {
    return null;
  }
}

async function download(url: string, fetchImpl: typeof fetch) {
  const res = await fetchImpl(url);
  if (!res.ok || !res.body)
    throw new Error(`downloading cloudflared failed: ${res.status}`);
  const chunks: Buffer[] = [];
  let size = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new Error("downloading cloudflared failed: too large");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

const untar = (archive: string, into: string) =>
  new Promise<void>((resolve, reject) =>
    execFile(
      "tar",
      ["-xzf", archive, "-C", into, "cloudflared"],
      { timeout: 60_000 },
      (err) =>
        err
          ? reject(new Error("unpacking cloudflared failed"))
          : resolve(undefined)
    )
  );

/**
 * The path of a verified cloudflared, downloading it first if needed. The
 * binary on disk is re-hashed every time, so a swapped file is replaced
 * rather than run.
 */
export async function ensureCloudflared(opts: {
  dir: string;
  pin?: Pin | null;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}): Promise<string> {
  const pin = opts.pin === undefined ? pinFor() : opts.pin;
  if (!pin)
    throw new Error(
      `cloudflared isn't available for ${process.platform}-${os.arch()}`
    );
  const binDir = path.join(opts.dir, "bin");
  const target = path.join(binDir, `cloudflared-${CLOUDFLARED_VERSION}`);
  if (sha256File(target) === pin.binarySha256) {
    fs.chmodSync(target, 0o700);
    return target;
  }
  fs.mkdirSync(binDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(binDir, 0o700);
  const data = await download(
    `${opts.baseUrl ?? RELEASES}/${CLOUDFLARED_VERSION}/${pin.asset}`,
    opts.fetchImpl ?? fetch
  );
  if (sha256(data) !== pin.assetSha256)
    throw new Error("cloudflared download doesn't match its pinned SHA-256");

  const work = fs.mkdtempSync(path.join(binDir, ".download-"));
  try {
    let binary = data;
    if (pin.asset.endsWith(".tgz")) {
      const archive = path.join(work, "cloudflared.tgz");
      fs.writeFileSync(archive, data, { mode: 0o600 });
      await untar(archive, work);
      binary = fs.readFileSync(path.join(work, "cloudflared"));
    }
    if (sha256(binary) !== pin.binarySha256)
      throw new Error("cloudflared binary doesn't match its pinned SHA-256");
    // Written owner-only and not executable; made executable only once
    // it's known to be the pinned binary, then moved into place.
    const staged = path.join(work, "staged");
    fs.writeFileSync(staged, binary, { mode: 0o600 });
    if (sha256File(staged) !== pin.binarySha256)
      throw new Error("cloudflared binary doesn't match its pinned SHA-256");
    fs.chmodSync(staged, 0o700);
    fs.renameSync(staged, target);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  return target;
}
