// One hover tooltip for the whole app. An element opts in with data-tip
// (plain text) or data-tip-key ("session:<id>", resolved when it opens by
// whoever registered that prefix). Rows carry an attribute and nothing
// else: one element and a few passive document listeners do the rest, and
// a touch screen attaches none. It opens after resting on something, and
// once one is open the next opens at once, so a list can be scanned.

export interface TipContent {
  title: string;
  lines: [label: string, value: string][];
}
export type TipValue = string | TipContent | null | undefined;

export const OPEN_DELAY_MS = 600;
export const WARM_MS = 400;
const SELECTOR = "[data-tip],[data-tip-key]";
const TIP_ID = "hover-tip";

const resolvers = new Map<string, (id: string) => TipValue>();

export function registerTip(
  prefix: string,
  resolve: (id: string) => TipValue
): () => void {
  resolvers.set(prefix, resolve);
  return () => {
    if (resolvers.get(prefix) === resolve) resolvers.delete(prefix);
  };
}

export function resolveTip(el: Element): TipValue {
  const key = el.getAttribute("data-tip-key");
  if (key) {
    const at = key.indexOf(":");
    const value = resolvers.get(key.slice(0, at))?.(key.slice(at + 1));
    if (value) return value;
  }
  return el.getAttribute("data-tip");
}

// Text only: names are user text and never parsed as HTML.
function fill(el: HTMLElement, value: string | TipContent) {
  if (typeof value === "string") {
    el.textContent = value;
    return;
  }
  const doc = el.ownerDocument;
  const title = doc.createElement("div");
  title.className = "font-medium";
  title.textContent = value.title;
  const rows = value.lines.map(([label, text]) => {
    const line = doc.createElement("div");
    const k = doc.createElement("span");
    k.className = "text-muted-foreground";
    k.textContent = `${label} `;
    line.append(k, text);
    return line;
  });
  el.replaceChildren(title, ...rows);
}

// Beside the target (a sidebar row's tip opens over the page, not the
// list), flipped or dropped below when there's no room. One measure.
function place(el: HTMLElement, target: Element, win: Window) {
  const r = target.getBoundingClientRect();
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const gap = 8;
  let x = r.right + gap;
  let y = r.top;
  if (x + w > win.innerWidth - gap) x = r.left - w - gap;
  if (x < gap) {
    x = Math.min(Math.max(gap, r.left), win.innerWidth - w - gap);
    y = r.bottom + gap;
  }
  y = Math.max(gap, Math.min(y, win.innerHeight - h - gap));
  el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

// Works across documents (tests, frames), unlike instanceof Element.
const isElement = (node: EventTarget | null): node is Element =>
  !!node && typeof (node as Element).closest === "function";

export function installHoverTip(win: Window = window): () => void {
  if (!win.matchMedia?.("(hover: hover) and (pointer: fine)").matches)
    return () => {};
  const doc = win.document;
  const el = doc.createElement("div");
  el.id = TIP_ID;
  el.setAttribute("role", "tooltip");
  el.className =
    "popover-surface text-popover-foreground pointer-events-none fixed top-0 left-0 z-[60] max-w-72 rounded-lg px-2.5 py-1.5 text-xs leading-relaxed whitespace-pre-line";
  el.hidden = true;
  doc.body.append(el);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Element | null = null;
  let shown: Element | null = null;
  let warmUntil = 0;

  const hide = () => {
    clearTimeout(timer);
    timer = undefined;
    pending = null;
    if (shown) {
      shown.removeAttribute("aria-describedby");
      warmUntil = Date.now() + WARM_MS;
      shown = null;
    }
    el.hidden = true;
  };
  const show = (target: Element) => {
    timer = undefined;
    if (!target.isConnected) return;
    const value = resolveTip(target);
    if (!value) return;
    fill(el, value);
    el.hidden = false;
    place(el, target, win);
    target.setAttribute("aria-describedby", TIP_ID);
    shown = target;
  };
  const arm = (target: Element | null) => {
    if (target && (target === pending || target === shown)) return;
    hide();
    if (!target) return;
    pending = target;
    if (Date.now() < warmUntil) show(target);
    else timer = setTimeout(() => show(target), OPEN_DELAY_MS);
  };
  const tipOf = (node: EventTarget | null) =>
    isElement(node) ? node.closest(SELECTOR) : null;

  const onOver = (e: Event) => arm(tipOf(e.target));
  const onOut = (e: Event) => {
    if (!(e as PointerEvent).relatedTarget) hide();
  };
  const onFocusIn = (e: Event) => {
    const t = e.target;
    if (isElement(t) && t.matches(SELECTOR) && t.matches(":focus-visible"))
      arm(t);
  };
  const passive = { passive: true } as const;
  const listeners: [string, (e: Event) => void, AddEventListenerOptions][] = [
    ["pointerover", onOver, passive],
    ["pointerout", onOut, passive],
    ["pointerdown", hide, passive],
    ["keydown", hide, passive],
    ["focusin", onFocusIn, passive],
    ["focusout", hide, passive],
    ["scroll", hide, { passive: true, capture: true }],
  ];
  for (const [type, fn, opts] of listeners)
    doc.addEventListener(type, fn, opts);
  return () => {
    hide();
    for (const [type, fn, opts] of listeners)
      doc.removeEventListener(type, fn, opts);
    el.remove();
  };
}
