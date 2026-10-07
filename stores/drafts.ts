import { proxy, subscribe } from "valtio";
import { draftComposerKey, type Draft } from "@/lib/drafts";
import { clearDraft, loadDraft } from "@/components/Chat/useDraft";

const KEY = "agentos:drafts";

const STALE_EMPTY_MS = 24 * 60 * 60 * 1000;

// Drafts live in this browser until sent; what's typed in each is kept by
// its composer under draftComposerKey. Read after the page mounts, so the
// server's render and the browser's first one agree.
export const draftsStore = proxy<{
  drafts: Record<string, Draft>;
  hydrated: boolean;
}>({ drafts: {}, hydrated: false });

export function hydrateDrafts(now = Date.now()): void {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<
      string,
      Draft
    >;
    // An empty draft left from yesterday is nobody's work.
    for (const d of Object.values(saved))
      if (now - d.createdAt < STALE_EMPTY_MS || draftHasText(d.id))
        draftsStore.drafts[d.id] = d;
  } catch {
    // Unreadable: start with none.
  }
  draftsStore.hydrated = true;
}

if (typeof window !== "undefined")
  subscribe(draftsStore, () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(draftsStore.drafts));
    } catch {
      // Storage full or blocked: drafts last until a reload.
    }
  });

export function draftHasText(id: string): boolean {
  const saved = loadDraft(draftComposerKey(id));
  return !!(saved?.text.trim() || saved?.images.length || saved?.files?.length);
}

export const draftsActions = {
  put: (draft: Draft) => {
    draftsStore.drafts[draft.id] = draft;
  },
  update: (id: string, patch: Partial<Omit<Draft, "id">>) => {
    const d = draftsStore.drafts[id];
    if (d) Object.assign(d, patch);
  },
  remove: (id: string) => {
    delete draftsStore.drafts[id];
    clearDraft(draftComposerKey(id));
  },
};

// Where a new draft goes: the current (or most recent) project, a project
// picked in the palette, a scratch chat, a given project, or an existing
// draft. Raised anywhere (keys, palette, sidebar, phone), handled by the page.
export type DraftRequest =
  | { kind: "current"; openPr?: boolean }
  | { kind: "choose"; openPr?: boolean }
  | { kind: "scratch" }
  | { kind: "project"; projectId: string; openPr?: boolean }
  | { kind: "open"; draftId: string };

export const draftRequests = proxy<{ request: DraftRequest | null }>({
  request: null,
});

export const newDraft = (request: DraftRequest) => {
  draftRequests.request = { ...request };
};
