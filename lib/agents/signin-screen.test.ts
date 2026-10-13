import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findSignIn, trustedSignInUrl } from "./signin-screen";

const fixture = readFileSync(
  join(__dirname, "../__fixtures__/screens/kiro-device-login.txt"),
  "utf8"
);

describe("findSignIn", () => {
  it("finds the link and code of a device login", () => {
    expect(findSignIn(fixture)).toEqual({
      url: "https://view.awsapps.com/start/#/device?user_code=ABCD-EFGH",
      code: "ABCD-EFGH",
    });
  });

  it("takes a code printed on its own line when the link has none", () => {
    expect(
      findSignIn(
        "Open this page to sign in:\nhttps://device.sso.us-east-1.amazonaws.com/\nEnter code: WXYZ-1234"
      )
    ).toEqual({
      url: "https://device.sso.us-east-1.amazonaws.com/",
      code: "WXYZ-1234",
    });
  });

  it("puts back a link the pane cut across lines", () => {
    const found = findSignIn(
      "Open this URL to sign in:\nhttps://view.awsapps.com/start/#/device?user_c\node=ABCD-EFGH"
    );
    expect(found?.url).toBe(
      "https://view.awsapps.com/start/#/device?user_code=ABCD-EFGH"
    );
    expect(found?.code).toBe("ABCD-EFGH");
  });

  it("is over once the CLI says it is signed in", () => {
    expect(findSignIn(`${fixture}\nLogged in successfully\n`)).toBeNull();
  });

  it("ignores a link with nothing about signing in near it", () => {
    expect(
      findSignIn("See https://kiro.dev/docs for the changelog.\nReady.")
    ).toBeNull();
    expect(findSignIn("❯ fix the build\n")).toBeNull();
  });
});

describe("trustedSignInUrl", () => {
  it("opens only https links to a sign-in host", () => {
    expect(trustedSignInUrl("https://view.awsapps.com/start/#/device")).toBe(
      true
    );
    expect(trustedSignInUrl("https://kiro.dev/login")).toBe(true);
    expect(trustedSignInUrl("http://view.awsapps.com/")).toBe(false);
    expect(trustedSignInUrl("https://evil.com/awsapps.com")).toBe(false);
    expect(trustedSignInUrl("https://awsapps.com.evil.com/")).toBe(false);
    expect(trustedSignInUrl("https://user@view.awsapps.com/")).toBe(false);
    expect(trustedSignInUrl("javascript:alert(1)")).toBe(false);
  });
});
