import "@/components/Chat/composer/test-dom";
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/db/types";

const toast = vi.hoisted(() =>
  Object.assign(vi.fn(), {
    loading: vi.fn(() => "t1"),
    success: vi.fn(),
    error: vi.fn(),
  })
);
vi.mock("sonner", () => ({ toast }));

const { useResurrectAction } = await import("./useDoneAction");

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;
const hook: { current: (s: Session) => void } = { current: () => {} };
const fetchSpy = vi.fn();

function Probe() {
  const restore = useResurrectAction();
  useEffect(() => {
    hook.current = restore;
  });
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchSpy);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(Probe)
      )
    )
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const task = {
  id: "s1",
  name: "Bookmark plan",
  task_status: "done",
} as Session;
const respond = (status: number, body: object) =>
  fetchSpy.mockResolvedValue({
    ok: status < 400,
    status,
    json: async () => body,
  });
const restore = async () => {
  await act(async () => {
    hook.current(task);
    await new Promise((r) => setTimeout(r, 0));
  });
};

describe("Restore from a session's menu", () => {
  it("posts to the resurrect route and shows what came back", async () => {
    respond(200, { outcome: { text: "Bookmark plan is back" } });
    await restore();
    expect(fetchSpy.mock.calls[0][0]).toBe("/api/sessions/s1/resurrect");
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ method: "POST" });
    expect(toast.success).toHaveBeenCalledWith(
      "Bookmark plan is back",
      expect.objectContaining({ id: "t1" })
    );
  });

  it("shows a refusal's reason", async () => {
    respond(409, { error: "its PR #3 was merged" });
    await restore();
    expect(toast.error).toHaveBeenCalledWith(
      "its PR #3 was merged",
      expect.objectContaining({ id: "t1" })
    );
  });
});
