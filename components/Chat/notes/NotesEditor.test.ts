import "@/components/Chat/composer/test-dom";
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@tiptap/core";
import { NotesEditor } from "./NotesEditor";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;
const fetchMock = vi.fn(
  async (_url: string, init?: RequestInit) =>
    new Response(
      JSON.stringify({
        sessionId: "s1",
        doc: JSON.parse(String(init?.body)).doc,
        updatedAt: "now",
      })
    )
);

const puts = () =>
  fetchMock.mock.calls.map(([url, init]) => ({
    url,
    text: JSON.stringify(JSON.parse(String(init?.body)).doc),
  }));

async function mount() {
  const client = new QueryClient();
  // StrictMode mounts, unmounts and mounts again, as dev does: the saver
  // must still save after that.
  await act(async () =>
    root.render(
      createElement(
        StrictMode,
        null,
        createElement(
          QueryClientProvider,
          { client },
          createElement(NotesEditor, {
            sessionId: "s1",
            initial: null,
            onState: () => {},
          })
        )
      )
    )
  );
  const el = host.querySelector(".ProseMirror") as HTMLElement & {
    editor: Editor;
  };
  return el.editor;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  host.remove();
});

describe("NotesEditor autosave", () => {
  it("saves the note a second after typing stops", async () => {
    const editor = await mount();
    await act(async () => {
      editor.commands.insertContent("first thought");
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(puts()).toHaveLength(1);
    expect(puts()[0].url).toBe("/api/sessions/s1/notes");
    expect(puts()[0].text).toContain("first thought");
    act(() => root.unmount());
  });

  it("saves what is waiting when closed, without waiting for the timer", async () => {
    const editor = await mount();
    await act(async () => {
      editor.commands.insertContent("closing now");
    });
    await act(async () => root.unmount());
    expect(puts()).toHaveLength(1);
    expect(puts()[0].text).toContain("closing now");
  });
});
