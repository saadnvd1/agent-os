import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { tempDir } from "@/lib/test-temp";
import {
  findBrowser,
  headlessShellPath,
  renderPdf,
  resetPdfBrowser,
} from "./pdf";

// Needs a real Chromium or Chrome; skipped where there is none (CI).
const browser = await findBrowser();

describe.skipIf(!browser)("renderPdf (real browser)", () => {
  it("prints a page with wide code and a table", async () => {
    const wide = "x".repeat(400);
    const html = `<!doctype html><html><head><title>t</title></head><body>
      <pre><code>${wide}</code></pre>
      <table><tr><td>${wide}</td></tr></table></body></html>`;
    const pdf = await renderPdf(html);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(1500);
    await resetPdfBrowser();
  }, 60_000);
});

describe("headlessShellPath", () => {
  const cache = tempDir("aos-install-");
  const make = (...parts: string[]) => {
    const file = path.join(cache, ...parts);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "");
    return file;
  };
  const full = path.join(cache, "chromium-1243", "chrome-linux64", "chrome");

  it("finds the shell installed at the same revision", () => {
    make(
      "chromium_headless_shell-1243",
      "chrome-headless-shell-linux64",
      "chrome-headless-shell"
    );
    expect(headlessShellPath(full)).toBe(
      path.join(
        cache,
        "chromium_headless_shell-1243",
        "chrome-headless-shell-linux64",
        "chrome-headless-shell"
      )
    );
  });

  it("ignores a shell at another revision, and a missing one", () => {
    make(
      "chromium_headless_shell-1248",
      "chrome-headless-shell-linux64",
      "chrome-headless-shell"
    );
    expect(
      headlessShellPath(path.join(cache, "chromium-1250", "x", "chrome"))
    ).toBeNull();
    expect(headlessShellPath("/usr/bin/google-chrome")).toBeNull();
  });
});
