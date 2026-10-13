import { beforeEach, describe, expect, it } from "vitest";
import { welcomeUi, welcomeUiActions } from "./welcomeUi";

describe("choosing a project in the welcome", () => {
  beforeEach(() => {
    welcomeUiActions.go("project");
    welcomeUiActions.setProject(null);
  });

  it("remembers it and lands on the devices step, not the finish", () => {
    welcomeUiActions.chooseProject("p1");
    expect(welcomeUi.projectId).toBe("p1");
    expect(welcomeUi.step).toBe("devices");
  });
});
