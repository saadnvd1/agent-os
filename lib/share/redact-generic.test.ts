import { describe, expect, it } from "vitest";
import { redactForShare } from "./redact";

// Fake credentials are built at runtime so no whole one is committed.
const rand = (n: number, set = "abcdefghijklmnopqrstuvwxyz0123456789") =>
  Array.from(
    { length: n },
    (_, i) => set[(i * 7 + (i % 5) * 13 + i * i) % set.length]
  ).join("");
const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const pw = ["hun", "ter2", "-pw!"].join("");
const run = (s: string) => redactForShare(s);
const masked = (s: string) => run(s).text;

describe("key-value secrets", () => {
  const cases: Record<string, [string, string]> = {
    equals: [`password=${pw}`, "password=[secret]"],
    colon: [`secret: ${pw}`, "secret: [secret]"],
    json: [`{"api_key": "${pw}"}`, `{"api_key": "[secret]"}`],
    yaml: [`client_secret: ${pw}\nname: x`, "client_secret: [secret]\nname: x"],
    export: [`export DB_PASSWORD=${pw}`, "export DB_PASSWORD=[secret]"],
    suffix: [`GITHUB_TOKEN=${pw}`, "GITHUB_TOKEN=[secret]"],
    lowerSuffix: [`my_access_key = '${pw}'`, "my_access_key = '[secret]'"],
    caseless: [`PassWd=${pw}`, "PassWd=[secret]"],
    pwd: [`pwd: ${pw}`, "pwd: [secret]"],
    auth: [`auth=${pw}`, "auth=[secret]"],
    privateKey: [`private_key: ${pw}`, "private_key: [secret]"],
    apikey: [`apikey=${pw}`, "apikey=[secret]"],
    flagEquals: [`--password=${pw}`, "--password=[secret]"],
    flagSpace: [`cli --password ${pw} run`, "cli --password [secret] run"],
    flagApiKey: [`cli --api-key ${pw}`, "cli --api-key [secret]"],
    mysql: [`mysql -u root -p${pw} db`, "mysql -u root -p[secret] db"],
  };
  for (const [name, [input, want]] of Object.entries(cases))
    it(`masks the value only: ${name}`, () => {
      const r = run(input);
      expect(r.text).toBe(want);
      expect(r.text).not.toContain(pw);
      expect(r.hits.secret).toBe(1);
    });

  it("leaves psql -p (a port) and prose keys alone", () => {
    expect(masked("psql -h db -p 5432 app")).toBe("psql -h db -p 5432 app");
    expect(masked("author: Jane\nmax_tokens: 4096")).toBe(
      "author: Jane\nmax_tokens: 4096"
    );
  });

  it("leaves types, placeholders and calls alone", () => {
    for (const s of [
      "token: string;",
      "password: <your password>",
      "const auth = useAuth();",
      "password=$DB_PASSWORD",
      "secret: ${{ secrets.X }}",
      "token: null",
    ])
      expect(masked(s)).toBe(s);
  });

  it("is idempotent and counts once", () => {
    const once = run(`{"password": "${pw}"}\nTOKEN=${pw}`);
    expect(run(once.text).text).toBe(once.text);
    expect(run(once.text).hits.secret).toBe(0);
    expect(once.hits.secret).toBe(2);
  });
});

describe("URL credentials and auth headers", () => {
  it("masks the userinfo of scheme://user:pass@host", () => {
    const r = run(`postgres://admin:${pw}@db.example.com/app`);
    expect(r.text).toBe("postgres://[secret]@db.example.com/app");
  });
  it("masks a password-only URL", () => {
    expect(masked(`redis://:${pw}@cache.example.com`)).toBe(
      "redis://[secret]@cache.example.com"
    );
  });
  it("masks Bearer and Basic headers", () => {
    const tok = rand(30, ALNUM);
    expect(masked(`Authorization: Bearer ${tok}`)).toBe(
      "Authorization: Bearer [secret]"
    );
    expect(masked(`-H 'Authorization: Basic ${btoa("u:" + pw)}'`)).toBe(
      "-H 'Authorization: Basic [secret]'"
    );
  });
});

describe("high-entropy tokens", () => {
  it("masks a long random token with mixed classes", () => {
    const tok = [
      "Zk3",
      "9Qx",
      "A1b",
      "7Lm",
      "Pq4",
      "Rt8",
      "Vw2",
      "Yd6",
      "Hn5",
      "Cj0",
      "Ft1",
      "Bs7",
    ].join("");
    expect(masked(`here it is ${tok} done`)).toBe("here it is [secret] done");
  });
  it("masks a base64-ish token with + / and =", () => {
    const tok = [
      "aB3+",
      "xY9/",
      "Kq7Z",
      "m2Wp",
      "Lr5T",
      "vN8c",
      "Ed4G",
      "hJ6s",
      "U1o=",
    ].join("");
    expect(masked(`k ${tok}`)).toBe("k [secret]");
  });
  it("masks a hex string longer than 64 characters", () => {
    expect(masked(`k ${"a1b2c3d4".repeat(9)}`)).toBe("k [secret]");
  });
});

describe("false positives", () => {
  const sha1 = "0123456789abcdef".repeat(3).slice(0, 40);
  const sha256 = "fedcba9876543210".repeat(4);
  const uuid = ["123e4567", "e89b", "12d3", "a456", "426614174000"].join("-");

  it("keeps git SHAs, hex hashes up to 64 characters and UUIDs", () => {
    for (const s of [sha1, sha256, uuid])
      expect(masked(`commit ${s} merged`)).toBe(`commit ${s} merged`);
  });
  it("keeps long identifiers and camelCase code", () => {
    for (const s of [
      "const someVeryLongIdentifierNameThatKeepsGoing = 1;",
      "function handleUserAuthenticationStateChangeEvent() {}",
      "THIS_IS_A_VERY_LONG_SCREAMING_SNAKE_CONSTANT_NAME",
      "a_very_long_snake_case_variable_name_here_ok",
    ])
      expect(masked(s)).toBe(s);
  });
  it("keeps file paths and plain prose", () => {
    for (const s of [
      "see /opt/app/projects/app/components/SessionList/Row2.tsx now",
      "open ./lib/share/some-very-long-file-name-redact.test.ts",
      "The quick brown fox jumps over the lazy dog. ".repeat(3).trim(),
    ])
      expect(masked(s)).toBe(s);
  });
  it("keeps base64 data URIs (inline images) intact", () => {
    const payload = rand(120, ALNUM) + "==";
    const s = `Here is the chart ![c](data:image/png;base64,${payload}) as shown.`;
    const r = run(s);
    expect(r.text).toBe(s);
    expect(r.hits.secret).toBe(0);
  });
  it("may mask npm integrity hashes (documented: they look like tokens)", () => {
    const hash = "sha512-" + rand(86, ALNUM) + "==";
    const r = run(`"integrity": "${hash}"`);
    expect(r.text).not.toContain(hash);
  });
});
