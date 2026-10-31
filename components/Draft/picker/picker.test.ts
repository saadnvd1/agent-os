import "@/components/Chat/composer/test-dom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { currentModelValue, ModelPicker } from "@/components/Chat/ModelPicker";
import type { CatalogAgent, MachineCatalog } from "@/lib/machines/types";
import { AgentModelPicker } from "./AgentModelPicker";

// Radix dispatches CustomEvents; the node global is not jsdom's.
Object.defineProperty(globalThis, "CustomEvent", {
  value: (window as unknown as { CustomEvent: unknown }).CustomEvent,
  configurable: true,
});
// A desktop, so the dialog layout and its autofocus apply.
Object.defineProperty(window, "matchMedia", {
  value: () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }),
  configurable: true,
});
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as Record<string, unknown>).ResizeObserver ??= RO;

const agent = (id: string, label: string, models: string[]): CatalogAgent => ({
  agent: id as CatalogAgent["agent"],
  label,
  installed: true,
  auth: "ok" as CatalogAgent["auth"],
  hint: null,
  models: models.map((m) => ({ value: m, label: m.toUpperCase() })),
  defaultModel: models[0],
  taskBlocked: null,
  modelsError: null,
});

const catalog: MachineCatalog = {
  agents: [
    agent("claude", "Claude Code", ["opus", "sonnet"]),
    agent("codex", "Codex", ["gpt-a", "gpt-flash"]),
  ],
  ollama: [],
  recent: [{ agent: "claude", model: "sonnet" }],
};

const press = async (key: string, target: Element) =>
  act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })
    );
  });

const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((r) => r.unmount()));
  document.body.innerHTML = "";
});

async function mount(node: () => ReturnType<typeof createElement>) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push(root);
  await act(async () => root.render(node()));
  const rerender = (n: ReturnType<typeof createElement>) =>
    act(async () => root.render(n));
  return { rerender };
}

const agentPicker = (open: boolean) =>
  createElement(AgentModelPicker, {
    open,
    onOpenChange: vi.fn(),
    catalog,
    value: { agent: "claude", model: "opus" },
    projectName: "proj",
    onPick: vi.fn(),
  });

const search = () => document.querySelector("input") as HTMLInputElement | null;

describe("currentModelValue", () => {
  const models = [{ value: "opus", label: "Opus" }];
  it("maps a full Claude id to its family alias", () => {
    expect(currentModelValue(models, "claude-opus-5-5")).toBe("opus");
    expect(currentModelValue(models, "opus")).toBe("opus");
    expect(currentModelValue(models, "claude-haiku-5-5")).toBeUndefined();
  });
});

describe("ModelPicker", () => {
  it("marks the chat's model and names the agent in the lock bar", async () => {
    await mount(() =>
      createElement(ModelPicker, {
        models: [
          { value: "sonnet", label: "Sonnet" },
          { value: "opus", label: "Opus" },
        ],
        model: "claude-opus-5-5",
        agentName: "Claude Code",
        open: true,
        onOpenChange: vi.fn(),
        onPick: vi.fn(),
      })
    );
    const selected = document.querySelectorAll('[data-selected="true"]');
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toContain("Opus");
    expect(document.body.textContent).toContain(
      "Claude Code · switching agent starts a new session"
    );
  });
});

describe("AgentModelPicker", () => {
  it("starts each opening with an empty search", async () => {
    const { rerender } = await mount(() => agentPicker(true));
    const input = search()!;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )!.set!;
      set.call(input, "flash");
      input.dispatchEvent(
        new (window as unknown as { Event: typeof Event }).Event("input", {
          bubbles: true,
        })
      );
    });
    expect(search()!.value).toBe("flash");
    await rerender(agentPicker(false));
    await rerender(agentPicker(true));
    expect(search()!.value).toBe("");
  });

  it("puts focus on the new agent's model list after ←/→", async () => {
    await mount(() => agentPicker(true));
    const focused = () => document.activeElement as HTMLElement;
    await press("ArrowRight", focused());
    expect(focused().closest("[data-model-list]")).not.toBeNull();
    expect(focused().textContent).toContain("GPT-A");
    await press("ArrowDown", focused());
    expect(focused().textContent).toContain("GPT-FLASH");
  });
});
