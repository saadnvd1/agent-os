import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { ATTACHMENT_LIMITS } from "@/lib/attachments/policy";
import { attachmentsRoot } from "@/lib/attachments/store";
import { POST } from "./route";

const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n");
const ZIPPED = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.alloc(32, 7),
]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  Buffer.alloc(32, 1),
]);

const SESSION = "test-upload-session";

const upload = (
  filename: string,
  data: Buffer | string,
  extra: Record<string, unknown> = {}
) =>
  POST(
    new Request("http://localhost/api/files/upload-temp", {
      method: "POST",
      body: JSON.stringify({
        filename,
        base64: Buffer.from(data).toString("base64"),
        ...extra,
      }),
    })
  );

afterEach(() => {
  fs.rmSync(path.join(attachmentsRoot(), SESSION), {
    recursive: true,
    force: true,
  });
});

describe("POST /api/files/upload-temp", () => {
  it.each([
    ["report.pdf", PDF, "pdf"],
    ["sheet.xlsx", ZIPPED, "sheet"],
    ["letter.docx", ZIPPED, "doc"],
    ["data.csv", "a,b\n1,2\n", "sheet"],
    ["notes.md", "# hi\n", "text"],
    ["app.ts", "export const a = 1;\n", "text"],
    ["shot.png", PNG, "image"],
  ])("takes %s", async (name, data, kind) => {
    const res = await upload(name, data, { sessionId: SESSION });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe(kind);
    expect(body.path).toBe(path.join(attachmentsRoot(), SESSION, name));
    expect(fs.readFileSync(body.path)).toEqual(Buffer.from(data));
  });

  it("keeps the old shape: no session means temp storage and a path", async () => {
    const res = await upload("old.csv", "a,b\n");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.path).toContain("agent-os-screenshots");
    expect(body.path).not.toContain(attachmentsRoot());
    fs.rmSync(body.path);
  });

  it("refuses types it doesn't take, saying which", async () => {
    for (const name of ["a.zip", "tool.exe", "noext", "clip.mov"]) {
      const res = await upload(name, "x", { sessionId: SESSION });
      expect(res.status).toBe(415);
      expect((await res.json()).error).toContain(`${name}: this file type`);
    }
    expect(fs.existsSync(path.join(attachmentsRoot(), SESSION))).toBe(false);
  });

  it("refuses a file that isn't what its name says", async () => {
    for (const [name, data] of [
      ["fake.xlsx", "plain text"],
      ["fake.pdf", "plain text"],
      ["fake.xls", ZIPPED],
      ["fake.csv", Buffer.from([0, 1, 2, 0])],
      ["fake.png", PDF],
    ] as const) {
      const res = await upload(name, data, { sessionId: SESSION });
      expect(res.status, name).toBe(400);
      expect((await res.json()).error).toContain("doesn't look like a real");
    }
  });

  it("refuses an empty file and a missing body", async () => {
    expect((await upload("a.txt", "", { sessionId: SESSION })).status).toBe(
      400
    );
    const none = await POST(
      new Request("http://localhost/x", {
        method: "POST",
        body: JSON.stringify({ filename: "a.txt" }),
      })
    );
    expect(none.status).toBe(400);
  });

  it("refuses a file over the limit, and says what the limit is", async () => {
    const big = Buffer.alloc(ATTACHMENT_LIMITS.maxBytes + 1, 97);
    const res = await upload("big.csv", big, { sessionId: SESSION });
    expect(res.status).toBe(413);
    expect((await res.json()).error).toContain("the limit is 25.0 MB");
  });

  it("takes shell scripts, config and extensionless names as text", async () => {
    for (const name of ["run.sh", "Dockerfile", ".env.example", "main.tf"]) {
      const res = await upload(name, "echo hi\n", { sessionId: SESSION });
      expect(res.status, name).toBe(200);
      expect((await res.json()).kind).toBe("text");
    }
  });

  it("names what is accepted when it refuses a type", async () => {
    const res = await upload("a.zip", "x", { sessionId: SESSION });
    expect((await res.json()).error).toMatch(/HAR.*HEIC|HEIC.*HAR/);
  });

  it("redacts a HAR on the way in and keeps a summary beside it", async () => {
    const secret = ["s", "3", "cr", "et"].join("") + Date.now();
    const har = JSON.stringify({
      log: {
        entries: [
          {
            request: {
              method: "GET",
              url: "https://api.example.com/me",
              headers: [{ name: "Authorization", value: `Bearer ${secret}` }],
              cookies: [{ name: "sid", value: secret }],
            },
            response: { status: 500, headers: [], cookies: [] },
          },
        ],
      },
    });
    const res = await upload("trace.har", har, { sessionId: SESSION });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mediaType).toBe("application/json");
    const saved = fs.readFileSync(body.path, "utf8");
    expect(saved).not.toContain(secret);
    expect(saved).toContain("api.example.com/me");
    expect(fs.readFileSync(`${body.path}.summary.txt`, "utf8")).toContain(
      "1 requests"
    );
  });

  it("refuses a .har that isn't a HAR", async () => {
    for (const data of ["not json", '{"log":{}}']) {
      const res = await upload("x.har", data, { sessionId: SESSION });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain("real HAR");
    }
  });

  it("refuses an image over the image limit", async () => {
    const big = Buffer.concat([
      PNG,
      Buffer.alloc(ATTACHMENT_LIMITS.maxImageBytes),
    ]);
    expect((await upload("big.png", big)).status).toBe(413);
  });

  it("refuses a body over the limit before reading it", async () => {
    const res = await POST(
      new Request("http://localhost/x", {
        method: "POST",
        headers: {
          "content-length": String(ATTACHMENT_LIMITS.maxTextBytes * 2),
        },
        body: "{}",
      })
    );
    expect(res.status).toBe(413);
  });

  it("keeps a hostile name inside the session's folder", async () => {
    const res = await upload("../../escape.pdf", PDF, { sessionId: SESSION });
    const { path: saved } = await res.json();
    expect(path.dirname(saved)).toBe(path.join(attachmentsRoot(), SESSION));
  });

  it("never overwrites: a second file with the same name gets its own", async () => {
    const a = await (await upload("x.csv", "1", { sessionId: SESSION })).json();
    const b = await (await upload("x.csv", "2", { sessionId: SESSION })).json();
    expect(a.path).not.toBe(b.path);
    expect(fs.readFileSync(a.path, "utf8")).toBe("1");
  });
});
