import { describe, expect, it } from "vitest";
import { hostLocality } from "./locality";

describe("hostLocality", () => {
  it.each([
    "http://localhost:11434/v1",
    "http://127.0.0.1:8080",
    "http://[::1]:8080/v1",
    "http://10.0.3.4:8000",
    "http://172.16.0.9",
    "http://172.31.255.1",
    "http://192.168.1.20:1234",
    "http://100.64.0.1:8000",
    "http://100.127.255.254",
    "http://gpu-box.local:8080",
    "http://gpu.example.ts.net:8080",
    "http://[fd12:3456::1]:80",
  ])("calls %s local", (url) => expect(hostLocality(url)).toBe("local"));

  it.each([
    "https://api.deepseek.com/anthropic",
    "http://172.32.0.1",
    "http://100.128.0.1",
    "http://100.63.0.1",
    "http://8.8.8.8",
    "https://localhost.evil.com",
    "not a url",
    "",
  ])("calls %s cloud", (url) => expect(hostLocality(url)).toBe("cloud"));

  it("is cloud with no endpoint", () => {
    expect(hostLocality(undefined)).toBe("cloud");
    expect(hostLocality(null)).toBe("cloud");
  });
});
