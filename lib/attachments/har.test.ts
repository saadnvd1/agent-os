import { describe, expect, it } from "vitest";
import { heicToJpeg, prepareUpload } from "./prepare";
import { redactHar, REDACTED } from "./har";
import { typeFor } from "./policy";

// Built at runtime so no token-shaped literal sits in the repo.
const tok = (label: string) =>
  `${label}-${["t", "o", "k"].join("")}-${Date.now()}`;
const BEARER = tok("bearer");
const COOKIE = tok("cookie");
const SETC = tok("setcookie");
const KEY = tok("key");
const XAUTH = tok("xauth");
const PROXY = tok("proxy");
const SECRETS = [BEARER, COOKIE, SETC, KEY, XAUTH, PROXY];

const fixture = () => ({
  log: {
    version: "1.2",
    entries: [
      {
        time: 120,
        request: {
          method: "POST",
          url: "https://api.example.com/v1/login?x=1",
          headers: [
            { name: "Authorization", value: `Bearer ${BEARER}` },
            { name: "Proxy-Authorization", value: `Basic ${PROXY}` },
            { name: "cookie", value: `sid=${COOKIE}` },
            { name: "X-API-Key", value: KEY },
            { name: "X-Auth-Token", value: XAUTH },
            { name: "Accept", value: "application/json" },
          ],
          cookies: [{ name: "sid", value: COOKIE }],
          postData: { text: '{"user":"a"}' },
        },
        response: {
          status: 401,
          headers: [
            { name: "Set-Cookie", value: `sid=${SETC}; HttpOnly` },
            { name: "Content-Type", value: "application/json" },
          ],
          cookies: [{ name: "sid", value: SETC }],
          content: { size: 40, text: '{"error":"nope"}' },
        },
      },
      {
        time: 5,
        request: {
          method: "GET",
          url: "https://cdn.example.com/a.js",
          headers: [],
        },
        response: { status: 200, headers: [], content: { size: 90000 } },
      },
    ],
  },
});

describe("redactHar", () => {
  it("replaces credential values and keeps everything else", () => {
    const out = redactHar(JSON.stringify(fixture()))!;
    for (const s of SECRETS) expect(out.json).not.toContain(s);
    const har = JSON.parse(out.json);
    const [login] = har.log.entries;
    expect(login.request.url).toBe("https://api.example.com/v1/login?x=1");
    expect(login.request.postData.text).toBe('{"user":"a"}');
    expect(
      login.request.headers.map((h: { name: string }) => h.name)
    ).toContain("X-Auth-Token");
    expect(login.request.headers.at(-1)).toEqual({
      name: "Accept",
      value: "application/json",
    });
    expect(login.request.headers[0].value).toBe(REDACTED);
    expect(login.request.cookies[0]).toEqual({ name: "sid", value: REDACTED });
    expect(login.response.status).toBe(401);
    expect(login.response.content.text).toBe('{"error":"nope"}');
    expect(login.time).toBe(120);
    expect(out.redacted).toBe(8);
  });

  it("summarizes hosts, statuses, the largest and failing requests", () => {
    const { summary } = redactHar(JSON.stringify(fixture()))!;
    expect(summary).toContain("2 requests, 2 hosts");
    expect(summary).toContain("2xx 1");
    expect(summary).toContain("4xx 1");
    expect(summary).toContain("GET https://cdn.example.com/a.js -> 200");
    expect(summary).toContain("Failing (1)");
    expect(summary).toContain(
      "POST https://api.example.com/v1/login?x=1 -> 401"
    );
    for (const s of SECRETS) expect(summary).not.toContain(s);
  });

  it("is null for anything that isn't a HAR", () => {
    expect(redactHar("nope")).toBeNull();
    expect(redactHar("{}")).toBeNull();
    expect(redactHar('{"log":{"entries":5}}')).toBeNull();
  });

  it("copes with odd entries", () => {
    const out = redactHar(
      JSON.stringify({
        log: { entries: [null, {}, { request: { headers: [null, 3] } }] },
      })
    );
    expect(out?.redacted).toBe(0);
  });
});

describe("prepareUpload", () => {
  it("redacts a HAR and refuses a bad one", async () => {
    const type = typeFor("t.har")!;
    const ok = await prepareUpload(
      type,
      "t.har",
      Buffer.from(JSON.stringify(fixture()))
    );
    expect(ok.ok && ok.data.toString()).not.toContain(BEARER);
    expect(ok.ok && ok.summary).toContain("2 requests");
    const bad = await prepareUpload(type, "t.har", Buffer.from("x"));
    expect(bad).toMatchObject({ ok: false, status: 400 });
  });

  it("leaves other files alone", async () => {
    const data = Buffer.from("a=1\n");
    expect(await prepareUpload(typeFor("a.ini")!, "a.ini", data)).toMatchObject(
      {
        ok: true,
        data,
        name: "a.ini",
      }
    );
  });

  it("converts HEIC to JPEG with the first tool that works, else keeps it", async () => {
    const heic = Buffer.from("heic bytes");
    const tried: string[] = [];
    const fake = async (cmd: string, args: string[]) => {
      tried.push(cmd);
      if (cmd === "sips") throw new Error("not found");
      const fs = await import("fs");
      fs.writeFileSync(args[args.length - 1], "jpeg bytes");
    };
    const out = await prepareUpload(
      typeFor("IMG_1.HEIC")!,
      "IMG_1.HEIC",
      heic,
      fake
    );
    expect(tried).toEqual(["sips", "magick"]);
    expect(out).toMatchObject({
      ok: true,
      name: "IMG_1.jpg",
      mediaType: "image/jpeg",
    });
    expect(out.ok && out.data.toString()).toBe("jpeg bytes");

    const none = await prepareUpload(
      typeFor("a.heif")!,
      "a.heif",
      heic,
      async () => {
        throw new Error("no tool");
      }
    );
    expect(none).toMatchObject({
      ok: true,
      name: "a.heif",
      mediaType: "image/heic",
    });
    expect(await heicToJpeg(heic, async () => {})).toBeNull();
  });
});
