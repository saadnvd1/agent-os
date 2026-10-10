"use client";

import type { ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import * as DM from "@/components/ui/dropdown-menu";
import * as CM from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";

export type RowMenuKind = "dropdown" | "context";

// Every sidebar row's frame: a leading mark, title over subtitle, what's on
// the right (hidden under the ⋯ on hover), and the same menu on ⋯ and on
// right-click. Session rows and queued tasks both draw through it.
export function RowShell({
  title,
  highlight,
  onClick,
  onActivate,
  leading,
  children,
  aside,
  trailing,
  menu,
  menuLabel,
  menuButton = true,
}: {
  title: string;
  highlight?: "selected" | "active" | null;
  onClick?: (e: React.MouseEvent) => void;
  // Enter or Space on the row; without it the row isn't a button.
  onActivate?: () => void;
  leading: ReactNode;
  children: ReactNode;
  // Stays on hover, unlike trailing.
  aside?: ReactNode;
  trailing?: ReactNode;
  // Null hides the ⋯ (and the right-click menu).
  menu: ((kind: RowMenuKind) => ReactNode) | null;
  menuLabel: string;
  // False keeps the right-click menu but hides the ⋯ (while selecting).
  menuButton?: boolean;
}) {
  const content = (
    <div
      role={onActivate ? "button" : undefined}
      tabIndex={onActivate ? 0 : undefined}
      title={title}
      onClick={onClick}
      onKeyDown={(e) => {
        if (!onActivate || e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate();
        }
      }}
      className={cn(
        "group relative flex min-h-11 items-center gap-2.5 rounded-lg px-2.5 py-1.5 transition-colors",
        onActivate && "cursor-pointer",
        highlight === "selected"
          ? "bg-primary/15"
          : highlight === "active"
            ? "bg-primary/10"
            : "hover:bg-foreground/[0.04]"
      )}
    >
      {leading}
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        {children}
      </span>
      {aside}
      <span className="flex shrink-0 items-center gap-2 md:group-hover:invisible md:group-has-[:focus-visible]:invisible md:group-has-[[data-state=open]]:invisible">
        {trailing}
      </span>
      {menu && menuButton && (
        <DM.DropdownMenu>
          <DM.DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={menuLabel}
              className="-mr-2.5 h-11 w-11 shrink-0 md:absolute md:top-1/2 md:right-1.5 md:mr-0 md:h-7 md:w-7 md:-translate-y-1/2 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 md:data-[state=open]:opacity-100 [@media(hover:none)]:md:static [@media(hover:none)]:md:-mr-2.5 [@media(hover:none)]:md:h-11 [@media(hover:none)]:md:w-11 [@media(hover:none)]:md:translate-y-0 [@media(hover:none)]:md:opacity-100"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DM.DropdownMenuTrigger>
          <DM.DropdownMenuContent
            align="end"
            className="w-56"
            onClick={(e) => e.stopPropagation()}
          >
            {menu("dropdown")}
          </DM.DropdownMenuContent>
        </DM.DropdownMenu>
      )}
    </div>
  );
  if (!menu) return content;
  return (
    <CM.ContextMenu>
      <CM.ContextMenuTrigger asChild>{content}</CM.ContextMenuTrigger>
      <CM.ContextMenuContent className="w-56">
        {menu("context")}
      </CM.ContextMenuContent>
    </CM.ContextMenu>
  );
}
