import { describe, expect, it } from "vitest";
import { redactForShare, type ShareContext } from "./redact";

// Every fake credential is assembled here so no whole one is committed.
const rand = (n: number, set = "abcdefghijklmnopqrstuvwxyz0123456789") =>
  Array.from(
    { length: n },
    () => set[Math.floor(Math.random() * set.length)]
  ).join("");
const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const tailnet = ["box", "example-net", "ts", "net"].join(".");

const ctx: ShareContext = {
  home: "/Users/" + "fakeuser",
  user: "fakeuser",
  secrets: [],
  hosts: ["fakebox", "build-" + "server"],
};
const run = (s: string, c = ctx) => redactForShare(s, c);

describe("secrets", () => {
  const cases: Record<string, string> = {
    anthropic: ["sk", "-ant-", rand(40, ALNUM)].join(""),
    openai: "sk-" + rand(40, ALNUM),
    github: ["gh", "p_", rand(36, ALNUM)].join(""),
    githubPat: ["github", "_pat_", rand(40, ALNUM)].join(""),
    aws: "AKIA" + rand(16, "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"),
    slack: ["xo", "xb-", rand(24, ALNUM)].join(""),
    jwt: [
      "eyJ",
      rand(20, ALNUM),
      ".",
      "eyJ",
      rand(20, ALNUM),
      ".",
      rand(20, ALNUM),
    ].join(""),
  };
  for (const [name, secret] of Object.entries(cases))
    it(`masks a ${name} token`, () => {
      const r = run(`before ${secret} after`);
      expect(r.text).toBe("before [secret] after");
      expect(r.hits.secret).toBe(1);
    });

  it("masks bearer tokens, assignments, URL credentials and secret query params", () => {
    const pw = rand(14, ALNUM);
    const r = run(
      [
        `curl -H "Authorization: Bearer ${pw}x"`,
        `API_KEY=${pw}`,
        `export DB_PASSWORD="${pw}"`,
        `postgres://app:${pw}@db.example.com/x`,
        `https://api.example.com/v1?token=${pw}&page=2`,
      ].join("\n")
    );
    expect(r.text).not.toContain(pw);
    expect(r.text).toContain("page=2");
    expect(r.text).toContain("db.example.com");
    expect(r.hits.secret).toBe(5);
  });

  it("masks a private key block", () => {
    const body = rand(60, ALNUM);
    const text = `x\n-----BEGIN ${"RSA "}PRIVATE KEY-----\n${body}\n-----END ${"RSA "}PRIVATE KEY-----\ny`;
    const r = run(text);
    expect(r.text).toBe("x\n[secret]\ny");
  });

  it("masks the value of a secret-looking environment variable wherever it appears", () => {
    const value = rand(20, ALNUM);
    const r = run(`the key is ${value}, again ${value}`, {
      ...ctx,
      secrets: [value],
    });
    expect(r.text).toBe("the key is [secret], again [secret]");
    expect(r.hits.secret).toBe(2);
  });

  it("ignores short env values so common words aren't masked", () => {
    expect(run("hello yes", { ...ctx, secrets: ["yes"] }).text).toBe(
      "hello yes"
    );
  });
});

describe("paths", () => {
  it("shows the home directory as ~", () => {
    const r = run(
      `open ${ctx.home}/code/app and /home/${"other"}/x and /Users/${"someone"}/y`
    );
    expect(r.text).toBe("open ~/code/app and ~/x and ~/y");
    expect(r.hits.path).toBe(3);
  });
  it("masks the account name in user@host", () => {
    expect(run("ssh fakeuser@fakebox").text).toBe("ssh user@[host]");
  });
});

describe("addresses and hosts", () => {
  it("masks IPv4 but keeps loopback", () => {
    const r = run("a 192.0.2.10, b 127.0.0.1, c 198.51.100.7:3000, 0.0.0.0");
    expect(r.text).toBe("a [ip], b 127.0.0.1, c [ip]:3000, 0.0.0.0");
    expect(r.hits.ip).toBe(2);
  });
  it("masks IPv6 but not times or loopback", () => {
    const r = run("at 12:30:45 ::1 and 2001:db8::1 and 2001:db8:0:0:0:0:0:2");
    expect(r.text).toBe("at 12:30:45 ::1 and [ip] and [ip]");
  });
  it("masks tailnet and private-network names, and this machine's names", () => {
    const r = run(
      `ssh ${tailnet}; printer.local; nas.home.arpa; fakebox; Build-Server`
    );
    expect(r.text).toBe("ssh [host]; [host]; [host]; [host]; [host]");
    expect(r.hits.host).toBe(5);
  });
  it("masks a Connect machine hostname", () => {
    const host = "m-" + "0123456789abcdef" + ".runagentos.com";
    expect(run(`https://${host}/x`).text).toBe("https://[host]/x");
  });
  it("leaves public hostnames and plain prose alone", () => {
    const text =
      "See https://github.com/org/repo and the fakeboxes docs, v1.2.3";
    expect(run(text).text).toBe(text);
  });
});

describe("emails", () => {
  it("masks addresses", () => {
    const r = run("from Ann <ann@example.org>");
    expect(r.text).toBe("from Ann <[email]>");
    expect(r.hits.email).toBe(1);
  });
});

describe("shape", () => {
  it("is idempotent", () => {
    const secret = ["gh", "p_", rand(36, ALNUM)].join("");
    const once = run(
      `${secret} ${ctx.home}/x 192.0.2.1 ${tailnet} a@b.example`
    );
    const twice = run(once.text);
    expect(twice.text).toBe(once.text);
    expect(twice.hits).toEqual({
      secret: 0,
      path: 0,
      ip: 0,
      host: 0,
      email: 0,
    });
  });
  it("counts API_KEY=value once", () => {
    expect(run(`API_KEY=${rand(20, ALNUM)}`).hits.secret).toBe(1);
  });
});

describe("only: secrets", () => {
  const text = `${ctx.home}/app on fakebox, mail a@b.co from 10.1.2.3, API_KEY=${rand(20, ALNUM)}`;
  const only = redactForShare(text, ctx, { only: ["secret"] });

  it("masks credentials but keeps paths, hosts, addresses and emails", () => {
    expect(only.text).toContain(`${ctx.home}/app`);
    expect(only.text).toContain("fakebox");
    expect(only.text).toContain("a@b.co");
    expect(only.text).toContain("10.1.2.3");
    expect(only.text).toContain("API_KEY=[secret]");
    expect(only.hits).toEqual({ secret: 1, path: 0, ip: 0, host: 0, email: 0 });
  });

  it("is the full redaction when not asked", () => {
    const all = run(text);
    expect(all.text).not.toContain("fakebox");
    expect(all.hits.secret).toBe(only.hits.secret);
  });
});
