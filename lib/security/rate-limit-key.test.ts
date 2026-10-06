import { describe, it, expect } from "vitest";
import { rateLimitKey } from "./rate-limit-key";

describe("rateLimitKey", () => {
  it("uses the network address, ignoring forwarded headers from elsewhere", () => {
    expect(rateLimitKey("192.168.1.20", "1.2.3.4")).toBe("192.168.1.20");
    expect(rateLimitKey("connect", "1.2.3.4")).toBe("connect");
    expect(rateLimitKey(null, "1.2.3.4")).toBe("unknown");
  });

  it("adds the forwarded client behind a proxy on this machine", () => {
    expect(rateLimitKey("127.0.0.1", "203.0.113.9, 10.0.0.1")).toBe(
      "127.0.0.1>203.0.113.9"
    );
    expect(rateLimitKey("::1", "203.0.113.9")).toBe("::1>203.0.113.9");
    expect(rateLimitKey("127.0.0.1", null)).toBe("127.0.0.1");
  });
});
