import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { seedStack } from "../stacks/testing";
import { dropTask, signOffTask } from "./finish";

describe("signing off a stacked task", () => {
  it("is refused while its parent has not merged, before anything runs", async () => {
    const s = seedStack(mkdtempSync(join(tmpdir(), "finish-")), [
      { key: "ENG-1", status: "pr", branch: "feature/p", pr: 1 },
      {
        key: "ENG-2",
        parent: "ENG-1",
        status: "pr",
        branch: "feature/c",
        baseBranch: "feature/p",
        pr: 2,
      },
    ]);
    await expect(signOffTask(s.session("ENG-2"))).rejects.toThrow(
      "ENG-2 is stacked on ENG-1, which has not merged. A stack merges bottom-up: sign off ENG-1 first."
    );
  });

  it("refuses dropping a task that live cards are stacked on", async () => {
    const s = seedStack(mkdtempSync(join(tmpdir(), "finish-")), [
      { key: "ENG-3", status: "pr", branch: "feature/p3", pr: 3 },
      {
        key: "ENG-4",
        parent: "ENG-3",
        status: "pr",
        branch: "feature/c4",
        pr: 4,
      },
    ]);
    await expect(dropTask(s.session("ENG-3"))).rejects.toThrow(
      "ENG-4 is stacked on this task and built on its branch. Drop it first, or sign this one off."
    );
  });
});
