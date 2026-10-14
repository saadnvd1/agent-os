"use client";

import { useState, type ComponentProps, type ElementType } from "react";
import { ChevronDown } from "lucide-react";
import * as DM from "@/components/ui/dropdown-menu";
import * as CM from "@/components/ui/context-menu";
import { useCompactMenu } from "@/hooks/useCompactMenu";
import { cn } from "@/lib/utils";

export const PARTS = {
  dropdown: {
    Item: DM.DropdownMenuItem,
    Separator: DM.DropdownMenuSeparator,
    Sub: DM.DropdownMenuSub,
    SubTrigger: DM.DropdownMenuSubTrigger,
    SubContent: DM.DropdownMenuSubContent,
  },
  context: {
    Item: CM.ContextMenuItem,
    Separator: CM.ContextMenuSeparator,
    Sub: CM.ContextMenuSub,
    SubTrigger: CM.ContextMenuSubTrigger,
    SubContent: CM.ContextMenuSubContent,
  },
};

export type MenuKind = keyof typeof PARTS;

export const icon = "mr-2 h-3.5 w-3.5";

// An item that is a 44px target on a phone.
export function MenuItem({
  kind,
  className,
  ...props
}: { kind: MenuKind } & ComponentProps<typeof DM.DropdownMenuItem>) {
  const compact = useCompactMenu();
  const Item = PARTS[kind].Item as typeof DM.DropdownMenuItem;
  return <Item className={cn(compact && "min-h-11", className)} {...props} />;
}

// A submenu on a desktop; on a phone or touch screen, a row that opens its
// items in place (a flyout can't be held open by a finger, and the list
// beneath it keeps scrolling as one).
export function Expander({
  kind,
  icon: Icon,
  label,
  children,
}: {
  kind: MenuKind;
  icon: ElementType;
  label: string;
  children: React.ReactNode;
}) {
  const compact = useCompactMenu();
  const [open, setOpen] = useState(false);
  const { Sub, SubTrigger, SubContent } = PARTS[kind];
  if (!compact)
    return (
      <Sub>
        <SubTrigger>
          <Icon className={icon} />
          {label}
        </SubTrigger>
        <SubContent>{children}</SubContent>
      </Sub>
    );
  return (
    <>
      <MenuItem
        kind={kind}
        aria-expanded={open}
        onSelect={(e) => {
          e.preventDefault();
          setOpen((o) => !o);
        }}
      >
        <Icon className={icon} />
        {label}
        <ChevronDown
          className={cn("ml-auto transition-transform", open && "rotate-180")}
        />
      </MenuItem>
      {open && (
        <div className="border-border ml-4 border-l pl-1">{children}</div>
      )}
    </>
  );
}
