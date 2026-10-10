import "@/components/Chat/composer/test-dom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  orchestratorOpenActions,
  orchestratorOpenStore,
} from "@/stores/orchestratorOpen";
import { OrchestratorStartRow } from "./OrchestratorPinRow";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;

beforeEach(async () => {
  orchestratorOpenActions.clear();
  host = document.createElement("div");
  root = createRoot(host);
  await act(async () =>
    root.render(
      createElement(OrchestratorStartRow, { workspaceId: "w1", name: "Poise" })
    )
  );
});
afterEach(() => act(() => root.unmount()));

describe("OrchestratorStartRow", () => {
  it("shows the workspace and offers to start its orchestrator", () => {
    expect(host.textContent).toBe("PoiseStart orchestrator");
  });

  it("asks the page to open (and so make) that workspace's orchestrator", () => {
    const row = host.querySelector<HTMLElement>('[role="button"]')!;
    act(() => row.click());
    expect(orchestratorOpenStore.request?.workspaceId).toBe("w1");
  });

  it("opens from the keyboard too", () => {
    const row = host.querySelector<HTMLElement>('[role="button"]')!;
    act(() => {
      row.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true })
      );
    });
    expect(orchestratorOpenStore.request?.workspaceId).toBe("w1");
  });
});
