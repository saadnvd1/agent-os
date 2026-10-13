import { describe, expect, it } from "vitest";
import { appPairLink, isPhoneOrTablet, pairPageLink } from "./pair-link";

const CODE = "ABCD-EFGH-JKMN-PQRS";

describe("appPairLink", () => {
  it("encodes the pairing page so the code stays inside the url param", () => {
    expect(appPairLink("https://host.example:3011", CODE)).toBe(
      "agentos://connect?url=https%3A%2F%2Fhost.example%3A3011%2Fpair%23ABCD-EFGH-JKMN-PQRS"
    );
  });

  it("round-trips to the pairing page link", () => {
    const link = appPairLink("http://192.0.2.7:3011", CODE);
    expect(new URL(link).searchParams.get("url")).toBe(
      pairPageLink("http://192.0.2.7:3011", CODE)
    );
  });

  it("does not double a trailing slash", () => {
    expect(pairPageLink("https://host.example/", CODE)).toBe(
      `https://host.example/pair#${CODE}`
    );
  });
});

describe("isPhoneOrTablet", () => {
  it.each([
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
    "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)",
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile",
    "Mozilla/5.0 (Linux; Android 14; SM-X900)",
  ])("is true for %s", (ua) => expect(isPhoneOrTablet(ua)).toBe(true));

  it("is false for desktops", () => {
    expect(isPhoneOrTablet("Mozilla/5.0 (Macintosh; Intel Mac OS X)", 0)).toBe(
      false
    );
    expect(isPhoneOrTablet("Mozilla/5.0 (Windows NT 10.0; Win64)")).toBe(false);
  });

  it("treats a touch-screen Mac user agent as an iPad", () => {
    expect(isPhoneOrTablet("Mozilla/5.0 (Macintosh; Intel Mac OS X)", 5)).toBe(
      true
    );
  });
});
