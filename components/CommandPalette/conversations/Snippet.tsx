import type { SnippetSegment } from "@/data/search";

// A match with the words that hit marked. Segments, never HTML: what was said
// in a chat is only ever text here.
export function Snippet({ segments }: { segments: SnippetSegment[] }) {
  return (
    <>
      {segments.map((s, i) =>
        s.hit ? (
          <mark
            key={i}
            className="bg-primary/20 text-foreground rounded-sm px-0.5"
          >
            {s.text}
          </mark>
        ) : (
          <span key={i}>
            {s.text.replace(/\*\*|__|`/g, "").replace(/\s+/g, " ")}
          </span>
        )
      )}
    </>
  );
}
