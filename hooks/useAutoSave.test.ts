import "@/components/Chat/composer/test-dom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoSave, type AutoSave } from "./useAutoSave";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

// A server whose value the hook is given back as `saved`, like a query.
async function mount(
  save: (n: number) => Promise<unknown>,
  notify = vi.fn(),
  initial = 10
) {
  const box: { auto: AutoSave<number> } = {} as never;
  let saved = initial;
  const Probe = ({ value }: { value: number }) => {
    box.auto = useAutoSave({
      saved: value,
      save: async (n) => {
        await save(n);
        saved = n;
      },
      notify,
    });
    return null;
  };
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const render = () =>
    act(async () => root.render(createElement(Probe, { value: saved })));
  await render();
  return { box, render, notify };
}

describe("useAutoSave", () => {
  it("saves a new value and says Saved, then goes quiet", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue(undefined);
    const { box, render } = await mount(save);
    await act(async () => void (await box.auto.commit(20)));
    await render();
    expect(save).toHaveBeenCalledWith(20);
    expect(box.auto.value).toBe(20);
    expect(box.auto.status).toBe("saved");
    await act(async () => void vi.advanceTimersByTime(2000));
    expect(box.auto.status).toBe("idle");
  });

  it("sends nothing for the value it already has", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { box } = await mount(save);
    await act(async () => void (await box.auto.commit(10)));
    expect(save).not.toHaveBeenCalled();
    expect(box.auto.status).toBe("idle");
  });

  it("shows the value while saving", async () => {
    let finish!: () => void;
    const save = vi.fn(() => new Promise<void>((r) => (finish = r)));
    const { box } = await mount(save);
    let done!: Promise<boolean>;
    await act(async () => void (done = box.auto.commit(20)));
    expect(box.auto.status).toBe("saving");
    expect(box.auto.value).toBe(20);
    await act(async () => {
      finish();
      await done;
    });
  });

  it("rolls back to the saved value and tells the user when the server rejects", async () => {
    const save = vi.fn().mockRejectedValue(new Error("Must be 50 or more"));
    const { box, notify } = await mount(save);
    let ok = true;
    await act(async () => void (ok = await box.auto.commit(20)));
    expect(ok).toBe(false);
    expect(box.auto.value).toBe(10);
    expect(box.auto.status).toBe("idle");
    expect(notify).toHaveBeenCalledWith("Must be 50 or more");
  });

  it("undoes an undoable change by saving the old value back", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { box, render } = await mount(save);
    await act(async () => void (await box.auto.commit(0, { undoable: true })));
    await render();
    expect(box.auto.status).toBe("undo");
    await act(async () => void (await box.auto.undo()));
    await render();
    expect(save).toHaveBeenLastCalledWith(10);
    expect(box.auto.value).toBe(10);
    expect(box.auto.status).toBe("saved");
  });

  it("has nothing to undo after a plain change", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { box } = await mount(save);
    await act(async () => void (await box.auto.commit(20)));
    let ok = true;
    await act(async () => void (ok = await box.auto.undo()));
    expect(ok).toBe(false);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
