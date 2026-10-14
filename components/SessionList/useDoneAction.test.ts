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

const { useDoneAction } = await import("./useDoneAction");

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;
const hook: { current: (s: Session) => void } = { current: () => {} };
const confirmSpy = vi.fn(() => false);
const fetchSpy = vi.fn();

function Probe() {
  const markDone = useDoneAction();
  useEffect(() => {
    hook.current = markDone;
  });
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("confirm", confirmSpy);
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

const quick = {
  id: "q1",
  name: "Fix pair page menu label",
  quick_of: "orch",
  task_status: "running",
  pr_status: "open",
  pr_number: 281,
} as Session;

const respond = (status: number, body: object) =>
  fetchSpy.mockResolvedValue({
    ok: status < 400,
    status,
    json: async () => body,
  });
// Done on an open PR asks first, in a toast; Merge is its action.
const confirmMerge = () => {
  const [, opts] = toast.mock.calls.at(-1) as unknown as [
    string,
    { action: { onClick: () => void } },
  ];
  act(() => opts.action.onClick());
};
const settle = () => act(() => new Promise((r) => setTimeout(r, 0)));

describe("Done from a row's menu", () => {
  it("asks in the app, not with confirm(), and does nothing until Merge is chosen", async () => {
    respond(200, {
      outcome: {
        id: "q1",
        name: quick.name,
        merged: "Merged.",
        worktree: { action: "none" },
        text: "Merged. Agent stopped, no worktree.",
      },
    });
    act(() => hook.current(quick));
    expect(fetchSpy).not.toHaveBeenCalled();
    confirmMerge();
    await settle();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/sessions/q1/done",
      expect.objectContaining({ method: "POST" })
    );
    expect(toast.success).toHaveBeenCalledWith(
      "Merged. Agent stopped, no worktree.",
      expect.objectContaining({ id: "t1" })
    );
  });

  it("shows a refusal as a toast naming the gate, for a quick change and a task", async () => {
    respond(409, {
      error: "Not done, nothing merged.\n- ci failed: CI failed",
    });
    act(() => hook.current(quick));
    confirmMerge();
    await settle();
    act(() => hook.current({ ...quick, id: "t2", quick_of: null } as Session));
    confirmMerge();
    await settle();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(toast.error).toHaveBeenCalledTimes(2);
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("ci failed"),
      expect.objectContaining({ id: "t1" })
    );
  });

  it("ends the Merging toast with an error when the server never answers", async () => {
    vi.useFakeTimers();
    fetchSpy.mockImplementation(
      (_url: string, init: { signal?: AbortSignal }) =>
        new Promise((_, reject) =>
          init.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason)
          )
        )
    );
    act(() => hook.current(quick));
    confirmMerge();
    expect(toast.error).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(181_000));
    vi.useRealTimers();
    expect(toast.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ id: "t1" })
    );
  });
});
