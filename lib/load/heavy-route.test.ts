import http from "http";
import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import type { AddressInfo } from "net";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/load/heavy/route";
import { heavyRegistry } from "./monitor";

const post = (body: unknown) =>
  POST(
    new NextRequest("http://localhost/api/load/heavy", {
      method: "POST",
      body: JSON.stringify(body),
    })
  );

afterEach(() =>
  heavyRegistry()
    .active()
    .forEach((r) => heavyRegistry().finish(r.key))
);

describe("POST /api/load/heavy", () => {
  it("refuses a missing pid or command and registers nothing", async () => {
    for (const body of [
      { command: "npm test" },
      { pid: 0, command: "npm test" },
      { pid: 1.5, command: "npm test" },
      { pid: process.pid, command: "  " },
    ])
      expect((await post(body)).status).toBe(400);
    expect(heavyRegistry().active()).toEqual([]);
  });

  it("shows other agents a program's name, never its arguments or env", async () => {
    await post({
      pid: process.pid,
      command: "API_KEY=sk-abc123 ./scripts/deploy.sh --token x",
    });
    expect(
      heavyRegistry()
        .active()
        .map((r) => r.label)
    ).toEqual(["deploy.sh"]);
    const res = await post({ pid: process.ppid, command: "npx vitest run" });
    expect((await res.json()).note).toMatch(
      /1 heavy command already running \(outside a session: deploy\.sh\)/
    );
  });
});

// bin/aos heavy against a server that may be down or slow.
function aosHeavy(args: string[], url: string) {
  return new Promise<{ code: number | null; stderr: string; ms: number }>(
    (resolve) => {
      const start = Date.now();
      execFile(
        process.execPath,
        [path.join(process.cwd(), "bin/aos"), "heavy", "--", ...args],
        { env: { ...process.env, AGENTOS_URL: url } },
        (err, _stdout, stderr) =>
          resolve({
            code: err ? ((err as { code?: number }).code ?? null) : 0,
            stderr,
            ms: Date.now() - start,
          })
      );
    }
  );
}

describe("aos heavy", () => {
  it("runs the command at once and passes its exit code through, server down", async () => {
    const r = await aosHeavy(["sh", "-c", "exit 3"], "http://127.0.0.1:1");
    expect(r.code).toBe(3);
    expect(r.stderr).toBe("");
  });

  it("doesn't wait for a server that never answers", async () => {
    // The server notes when the registration arrives and never answers;
    // the command marks when it started. Awaiting the registration first
    // would start it only once the 1000ms fetch limit gave up.
    let arrived = 0;
    const server = http.createServer(() => {
      arrived ||= Date.now();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as AddressInfo;
    const stamp = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "aos-heavy-")),
      "started"
    );
    try {
      const r = await aosHeavy(
        ["sh", "-c", `: > '${stamp}'; sleep 0.5`],
        `http://127.0.0.1:${port}`
      );
      expect(r.code).toBe(0);
      expect(r.stderr).toBe("");
      expect(arrived).toBeGreaterThan(0);
      expect(fs.statSync(stamp).mtimeMs - arrived).toBeLessThan(800);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  it("prints the server's note", async () => {
    let body: { pid?: number; command?: string } = {};
    const server = http.createServer((req, res) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        body = JSON.parse(data);
        res.end(JSON.stringify({ note: "Note: load is red." }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as AddressInfo;
    try {
      const r = await aosHeavy(
        ["sh", "-c", "sleep 2"],
        `http://127.0.0.1:${port}`
      );
      expect(r).toMatchObject({ code: 0, stderr: "Note: load is red.\n" });
      expect(body.command).toBe("sh -c sleep 2");
      expect(body.pid).toBeGreaterThan(0);
    } finally {
      server.close();
    }
  });
});
