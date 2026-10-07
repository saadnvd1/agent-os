import { describe, expect, it } from "vitest";
import { ARTIFACT_CSP, ARTIFACT_SANDBOX, prepareArtifact } from "./serve";
import { ARTIFACT_IFRAME_SANDBOX } from "@/components/Chat/ArtifactFrame";
import { imageType } from "./image-paths";

describe("serving artifacts", () => {
  it("sandboxes the page without same-origin, in the header and the frame", () => {
    expect(ARTIFACT_CSP.startsWith(`sandbox ${ARTIFACT_SANDBOX};`)).toBe(true);
    for (const sandbox of [ARTIFACT_SANDBOX, ARTIFACT_IFRAME_SANDBOX]) {
      expect(sandbox).not.toMatch(/allow-same-origin/);
      expect(sandbox).not.toMatch(
        /allow-top-navigation|allow-popups|allow-modals/
      );
    }
    expect(ARTIFACT_IFRAME_SANDBOX).toBe(ARTIFACT_SANDBOX);
  });

  it("lets nothing load from this origin or be posted anywhere", () => {
    expect(ARTIFACT_CSP).toMatch(/default-src 'none'/);
    expect(ARTIFACT_CSP).toMatch(/form-action 'none'/);
    expect(ARTIFACT_CSP).not.toMatch(/'self'[^;]*;?.*connect-src[^;]*'self'/);
    expect(ARTIFACT_CSP).not.toMatch(/connect-src[^;]*'self'/);
  });

  it("adds its size reporter before </body>, or at the end", () => {
    const page = prepareArtifact("<html><body><p>x</p></body></html>");
    expect(page.indexOf("agentosArtifactHeight")).toBeLessThan(
      page.indexOf("</body>")
    );
    expect(prepareArtifact("<p>x</p>").startsWith("<p>x</p><style>")).toBe(
      true
    );
  });
});

describe("image paths", () => {
  it("knows absolute image paths and nothing else", () => {
    expect(imageType("/tmp/chart.svg")).toBe("image/svg+xml");
    expect(imageType("~/shots/a.PNG")).toBe("image/png");
    expect(imageType("chart.svg")).toBeNull();
    expect(imageType("/tmp/page.html")).toBeNull();
    expect(imageType("https://x.com/a.png")).toBeNull();
  });
});
