import { cn } from "@/lib/utils";

// A letter tile with a muted hue derived from the name, so each project is
// recognisable at a glance without anyone choosing colours.
export function ProjectAvatar({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return (
    <span
      aria-hidden
      style={{ "--avatar-hue": hue } as React.CSSProperties}
      className={cn(
        "flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold",
        "bg-[hsl(var(--avatar-hue)_30%_88%)] text-[hsl(var(--avatar-hue)_35%_28%)]",
        "dark:bg-[hsl(var(--avatar-hue)_25%_24%)] dark:text-[hsl(var(--avatar-hue)_40%_80%)]",
        className
      )}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}
