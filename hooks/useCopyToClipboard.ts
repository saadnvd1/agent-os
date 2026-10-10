import { useState, useCallback } from "react";
import { toast } from "sonner";
import { sessionLink } from "@/lib/session-url";

interface UseCopyToClipboardOptions {
  /** Duration to show copied feedback (ms). Default: 1500 */
  feedbackDuration?: number;
}

interface UseCopyToClipboardReturn {
  /** Whether the copy was successful (shows feedback) */
  copied: boolean;
  /** Copy text to clipboard */
  copy: (text: string) => Promise<boolean>;
}

/**
 * Hook for copying text to clipboard with visual feedback.
 *
 * @example
 * const { copied, copy } = useCopyToClipboard();
 * <button onClick={() => copy(text)}>
 *   {copied ? <Check /> : <Copy />}
 * </button>
 */
export function useCopyToClipboard(
  options: UseCopyToClipboardOptions = {}
): UseCopyToClipboardReturn {
  const { feedbackDuration = 1500 } = options;
  const [copied, setCopied] = useState(false);

  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      if (!text) return false;

      try {
        await writeClipboard(text);
        setCopied(true);
        setTimeout(() => setCopied(false), feedbackDuration);
        return true;
      } catch {
        // Clipboard API failed or unavailable
        return false;
      }
    },
    [feedbackDuration]
  );

  return { copied, copy };
}

// navigator.clipboard only exists in secure contexts; plain http over the
// tailnet falls back to a hidden textarea.
export async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard) return navigator.clipboard.writeText(text);
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!ok) throw new Error("copy failed");
}

// A session's own address (lib/session-url), for a bookmark or another device.
export async function copySessionLink(sessionId: string): Promise<void> {
  try {
    await writeClipboard(sessionLink(window.location.origin, sessionId));
    toast.success("Link copied");
  } catch {
    toast.error("Could not copy to clipboard");
  }
}
