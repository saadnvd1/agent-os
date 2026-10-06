"use client";

import dynamic from "next/dynamic";
import type { ComposerProps } from "./composer/ComposerBody";
import { usePlainMode } from "./composer/usePlainMode";

// The same size as an empty composer (a line of text over the toolbar), so
// nothing moves when the editor arrives.
function ComposerPlaceholder() {
  return (
    <div
      aria-hidden
      className="bg-card popover-surface h-24 rounded-2xl"
      data-composer-placeholder
    />
  );
}

// The editor (TipTap, lowlight, the markdown parser) is its own chunk,
// loaded after the chat itself.
const ComposerBody = dynamic(
  () => import("./composer/ComposerBody").then((m) => m.ComposerBody),
  { ssr: false, loading: ComposerPlaceholder }
);

export function Composer(props: ComposerProps) {
  // Held until this browser's plain-mode choice is known, so the editor is
  // only ever built once, in the right mode.
  const [plain] = usePlainMode();
  if (plain === null) return <ComposerPlaceholder />;
  return <ComposerBody {...props} />;
}
