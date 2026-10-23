import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { claimKeys } from "@/data/claims/keys";
import { claimsUi, claimsUiActions } from "@/stores/claimsUi";
import { ClaimFiles } from "./ClaimFiles";
import { OverlapPill } from "./OverlapPill";
import { StartClaimsNotice } from "./StartClaimsNotice";
import { focusView, groupByRepo, lastHeardText, startedText } from "./format";
import type { Claim } from "@/lib/claims/types";

const overlap = {
  strength: "strong" as const,
  machine: "box",
  goal: "Rework login",
  shared: 3,
  claimId: "r-1",
  mineId: "s-1",
};

beforeEach(() => claimsUiActions.setOpen(false));

describe("OverlapPill", () => {
  it("reads Overlaps: <machine>, amber when strong", () => {
    const html = renderToStaticMarkup(createElement(OverlapPill, { overlap }));
    expect(html).toContain("Overlaps: box");
    expect(html).toContain("text-amber-700");
    expect(html).toContain('data-overlap="strong"');
  });

  it("is muted when weak", () => {
    const html = renderToStaticMarkup(
      createElement(OverlapPill, { overlap: { ...overlap, strength: "weak" } })
    );
    expect(html).toContain("text-muted-foreground");
    expect(html).not.toContain("text-amber-700");
  });

  it("opens the claims sheet on that pair when tapped", () => {
    const el = OverlapPill({ overlap }) as { props: { onClick: () => void } };
    el.props.onClick();
    expect(claimsUi.open).toBe(true);
    expect([...(claimsUi.focus ?? [])]).toEqual(["s-1", "r-1"]);
    claimsUiActions.showAll();
    expect(claimsUi.focus).toBeNull();
  });
});

describe("StartClaimsNotice", () => {
  const warnings = [
    {
      strength: "strong" as const,
      kinds: ["files" as const],
      shared: ["a.ts", "b.ts"],
      claim: {
        id: "r-1",
        goal: "Rework login",
        machine: "box",
        branch: "feature/login",
        sessionName: null,
      },
    },
  ];
  const html = renderToStaticMarkup(
    createElement(StartClaimsNotice, {
      warnings,
      busy: false,
      onStart: () => {},
      onDismiss: () => {},
    })
  );

  it("names the work and offers both choices", () => {
    expect(html).toContain("Rework login");
    expect(html).toContain("on box");
    expect(html).toContain("a.ts, b.ts");
    expect(html).toContain("Start anyway");
    expect(html).toContain("Start after it");
  });

  it("renders nothing without a warning", () => {
    expect(
      renderToStaticMarkup(
        createElement(StartClaimsNotice, {
          warnings: [],
          busy: false,
          onStart: () => {},
          onDismiss: () => {},
        })
      )
    ).toBe("");
  });
});

describe("claims keys and helpers", () => {
  it("keys the list by project", () => {
    expect(claimKeys.list()).toEqual(["claims", "list", ""]);
    expect(claimKeys.list("p1")).toEqual(["claims", "list", "p1"]);
    expect(claimKeys.list("p1").slice(0, 1)).toEqual(claimKeys.all);
  });

  it("words ages and last heard", () => {
    expect(startedText({ startedAt: 0 }, 12 * 60_000)).toBe("started 12m ago");
    expect(startedText({ startedAt: 0 }, 5_000)).toBe("just started");
    expect(lastHeardText(0, 6 * 60_000)).toBe("last heard 6m ago");
    expect(lastHeardText(null, 0)).toBe("serves this dashboard");
  });

  const c = (id: string, repo: string, startedAt: number) =>
    ({ id, repo, startedAt, files: [], filesMore: 0 }) as unknown as Claim;

  it("groups by repo, oldest work first", () => {
    const groups = groupByRepo([
      c("a", "r2", 5),
      c("b", "r1", 9),
      c("c", "r2", 1),
    ]);
    expect(groups.map((g) => [g.repo, g.claims.map((x) => x.id)])).toEqual([
      ["r2", ["c", "a"]],
      ["r1", ["b"]],
    ]);
  });

  it("narrows to one pair", () => {
    const view = {
      claims: [c("a", "r", 1), c("b", "r", 2), c("z", "r", 3)],
      overlaps: [
        {
          a: "a",
          b: "b",
          kinds: ["files" as const],
          shared: [],
          strength: "weak" as const,
        },
        {
          a: "b",
          b: "z",
          kinds: ["files" as const],
          shared: [],
          strength: "weak" as const,
        },
      ],
    };
    const f = focusView(view, ["a", "b"]);
    expect(f.claims.map((x) => x.id)).toEqual(["a", "b"]);
    expect(f.overlaps).toHaveLength(1);
    expect(focusView(view, null)).toBe(view);
  });

  it("marks shared files in a claim's list", () => {
    const html = renderToStaticMarkup(
      createElement(ClaimFiles, {
        files: ["a.ts", "b.ts"],
        more: 2,
        shared: new Set(["a.ts"]),
      })
    );
    expect(html).toContain("and 2 more");
    expect(html.match(/text-amber-700/g)).toHaveLength(1);
  });
});
