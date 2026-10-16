import { describe, expect, it } from "vitest";
import { findBrowser, renderPdf, resetPdfBrowser } from "./pdf";

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
