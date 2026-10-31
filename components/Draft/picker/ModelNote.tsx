import { StatusPill } from "@/components/ui/status-pill";

// "15x usage" and up costs real quota; "Included" costs none.
export function noteTone(note: string): "amber" | "green" | "muted" {
  if (/included/i.test(note)) return "green";
  return parseFloat(note) >= 10 ? "amber" : "muted";
}

export function ModelNote({ note }: { note: string }) {
  return (
    <StatusPill tone={noteTone(note)} className="shrink-0">
      {note}
    </StatusPill>
  );
}
