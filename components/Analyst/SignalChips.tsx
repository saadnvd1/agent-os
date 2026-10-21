import type { DigestSignals } from "@/lib/analyst/types";
import { cn } from "@/lib/utils";

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

const shortCommand = (c: string) => (c.length > 40 ? `${c.slice(0, 39)}…` : c);

/** What the reviewed turns did, read without a model: the facts under the card. */
export function SignalChips({ signals: s }: { signals: DigestSignals }) {
  const chips: { text: string; tone?: "good" | "bad" }[] = [];
  chips.push({ text: plural(s.toolCalls, "tool call") });
  if (s.filesChanged.length)
    chips.push({ text: plural(s.filesChanged.length, "file") + " changed" });
  for (const c of s.checks)
    chips.push({
      text: `${shortCommand(c.command)} ${c.passed ? "passed" : "failed"}`,
      tone: c.passed ? "good" : "bad",
    });
  if (s.failedTools)
    chips.push({ text: plural(s.failedTools, "failed tool"), tone: "bad" });
  if (s.errors) chips.push({ text: plural(s.errors, "error"), tone: "bad" });
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <span
          key={c.text}
          className={cn(
            "bg-foreground/[0.05] text-muted-foreground max-w-full truncate rounded-md px-1.5 py-0.5 font-mono text-[11px]",
            c.tone === "good" &&
              "bg-green-500/10 text-green-700 dark:text-green-400",
            c.tone === "bad" && "bg-red-500/10 text-red-700 dark:text-red-400"
          )}
        >
          {c.text}
        </span>
      ))}
    </div>
  );
}
