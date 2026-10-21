import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const TONES = {
  amber: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  muted: "bg-muted text-muted-foreground",
  green: "bg-green-500/15 text-green-700 dark:text-green-400",
  primary: "bg-primary/15 text-primary",
  red: "bg-red-500/15 text-red-700 dark:text-red-400",
} as const;

/** A small coloured pill for a status. A button when it has an onClick. */
export function StatusPill({
  tone,
  className,
  onClick,
  ...props
}: Omit<ComponentProps<"span">, "onClick"> & {
  tone: keyof typeof TONES;
  onClick?: () => void;
}) {
  const classes = cn(
    "inline-flex max-w-full min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold",
    TONES[tone],
    className
  );
  if (!onClick) return <span className={classes} {...props} />;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        classes,
        "relative cursor-pointer before:absolute before:-inset-x-1 before:-inset-y-3 hover:brightness-110"
      )}
      {...(props as ComponentProps<"button">)}
    />
  );
}
