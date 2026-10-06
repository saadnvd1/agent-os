import "./test-dom";
import { createElement, useRef } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@tiptap/core";
import * as extensions from "./extensions";
import * as serialize from "@/lib/chat/markdown/serialize";
import { useComposerEditor, type ComposerHandlers } from "./useComposerEditor";

vi.mock("./extensions", async (original) => {
  const real = await original<typeof import("./extensions")>();
  return {
    richExtensions: vi.fn(real.richExtensions),
    plainExtensions: vi.fn(real.plainExtensions),
  };
});
vi.mock("@/lib/chat/markdown/serialize", async (original) => {
  const real = await original<typeof import("@/lib/chat/markdown/serialize")>();
  return { ...real, docToMarkdown: vi.fn(real.docToMarkdown) };
});

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Hook = ReturnType<typeof useComposerEditor>;
let root: Root;
let last: Hook;

function Probe({
  disabled,
  onHook,
}: {
  disabled?: boolean;
  onHook: (hook: Hook) => void;
}) {
  const handlers = useRef<ComposerHandlers | null>(null);
  onHook(useComposerEditor({ placeholder: "Message", disabled, handlers }));
  return null;
}

async function render(disabled = false) {
  await act(async () =>
    root.render(
      createElement(Probe, { disabled, onHook: (hook) => (last = hook) })
    )
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  root = createRoot(document.createElement("div"));
});
afterEach(() => act(() => root.unmount()));

const editor = () => last.editor as Editor;

describe("useComposerEditor", () => {
  it("builds its extensions once, not on every keystroke", async () => {
    await render();
    for (const md of ["a", "a **b**", "a **b** `c`"]) {
      await act(async () => last.setText(md));
      await render();
    }
    expect(extensions.richExtensions).toHaveBeenCalledTimes(1);
  });

  it("starts in a saved plain mode, never rich first", async () => {
    localStorage.setItem("agentos:composer:plain", "1");
    await render();
    expect(extensions.richExtensions).not.toHaveBeenCalled();
    expect(extensions.plainExtensions).toHaveBeenCalledTimes(1);
    expect(editor().schema.nodes.codeBlock).toBeUndefined();
  });

  it("disabling or loading text is not an edit", async () => {
    await render();
    await act(async () => last.setText("draft with **bold**"));
    const serialized = vi.mocked(serialize.docToMarkdown).mock.calls.length;
    await render(true);
    await render(false);
    expect(editor().isEditable).toBe(true);
    expect(vi.mocked(serialize.docToMarkdown).mock.calls.length).toBe(
      serialized
    );
    expect(last.text).toBe("draft with **bold**");
  });

  it("an edit does update the text", async () => {
    await render();
    await act(async () => {
      editor().commands.setContent("<p>hi</p>", { emitUpdate: true });
    });
    expect(last.text).toBe("hi");
  });
});
