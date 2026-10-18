// Whether a change touches what a user sees, and whether its PR body shows
// anyone looked. The note it makes is for the reviewer's detail only: UI
// screenshots are not a merge gate, so it can never change a verdict.

import type { ChangedFile } from "../orchestrator/diff";
import type { CheckStatus } from "../orchestrator/checks";
import { renderedLines } from "./code-review";

const UI_EXT =
  /\.(tsx|jsx|vue|svelte|astro|css|scss|sass|less|html|erb|haml|slim)$/i;
const UI_DIR = /(^|\/)(app\/views|app\/components)\//;
const SWIFT_VIEW = /(^|\/)(Views?\/.*|\w*Views?)\.swift$/;
const NOT_UI = /(\.(test|spec|stories)\.|(^|\/)(__tests__|spec|tests?|e2e)\/)/;

export function isUiPath(file: string): boolean {
  if (NOT_UI.test(file)) return false;
  return UI_EXT.test(file) || UI_DIR.test(file) || SWIFT_VIEW.test(file);
}

export function uiFilesIn(files: ChangedFile[]): string[] {
  return files
    .filter((f) => f.status !== "D" && isUiPath(f.path))
    .map((f) => f.path);
}

const IMAGE =
  /!\[|<img\b|\.(png|jpe?g|webp|gif)\b|user-images|githubusercontent/i;
const DESCRIBED =
  /browser check|simulator check|screenshot|chrome-devtools|viewports?\b|\b\d{3,4}\s*[x×]\s*\d{3,4}\b|in (a|the) (real )?browser|in the (ios )?simulator/i;

// Lenient on purpose: a nudge, not a gate. Undefined when the body wasn't read.
export function hasUiEvidence(
  body: string | null | undefined
): boolean | undefined {
  if (body === null || body === undefined) return undefined;
  return renderedLines(body).some((l) => IMAGE.test(l) || DESCRIBED.test(l));
}

export function uiEvidenceNote(
  files: ChangedFile[],
  evidence: boolean | undefined
): string | null {
  const ui = uiFilesIn(files);
  if (!ui.length || evidence !== false) return null;
  const shown = ui.slice(0, 3).join(", ");
  const more = ui.length > 3 ? `, +${ui.length - 3} more` : "";
  return `[minor] ${shown}${more}: this changes UI files and the PR body has no browser or simulator evidence (screenshots or a described check). Not a merge gate; add a Browser check section if you checked.`;
}

export function withUiEvidenceNote(
  verdict: { status: CheckStatus; detail: string },
  note: string | null
): { status: CheckStatus; detail: string } {
  return note
    ? { status: verdict.status, detail: `${verdict.detail}\n- ${note}`.trim() }
    : verdict;
}
