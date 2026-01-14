/**
 * ADropdownMenu - Declarative dropdown menu component
 *
 * @example
 * ```tsx
 * <ADropdownMenu
 *   trigger={<Button><MoreHorizontal /></Button>}
 *   items={[
 *     menuItem('Edit', onEdit, { icon: Pencil }),
 *     toggleItem('Full Width', isFullWidth, onToggle),
 *     separator(),
 *     menuItem('Delete', onDelete, { icon: Trash2, variant: 'destructive' }),
 *   ]}
 * />
 * ```
 */

"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  DropdownMenuPortal,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

// Types

interface BaseItem {
  key?: string;
  visible?: boolean;
}

export interface MenuItemConfig extends BaseItem {
  type: "item";
  label: string;
  onClick: () => void;
  icon?: LucideIcon;
  disabled?: boolean;
  variant?: "default" | "destructive";
}

export interface ToggleItemConfig extends BaseItem {
  type: "toggle";
  label: string;
  checked: boolean;
  onChange: () => void;
  icon?: LucideIcon;
  disabled?: boolean;
}

export interface SubmenuItemConfig extends BaseItem {
  type: "submenu";
  label: string;
  icon?: LucideIcon;
  items: DropdownItemConfig[];
  disabled?: boolean;
}

export interface SeparatorItemConfig extends BaseItem {
  type: "separator";
}

export interface CustomItemConfig extends BaseItem {
  type: "custom";
  render: () => ReactNode;
}

export type DropdownItemConfig =
  | MenuItemConfig
  | ToggleItemConfig
  | SubmenuItemConfig
  | SeparatorItemConfig
  | CustomItemConfig;

type FalsyItem = false | null | undefined | "" | 0;

export interface ADropdownMenuProps {
  trigger: ReactNode;
  items: (DropdownItemConfig | FalsyItem)[];
  align?: "start" | "center" | "end";
  minWidth?: string;
  className?: string;
}

function filterVisibleItems(
  items: (DropdownItemConfig | FalsyItem)[]
): DropdownItemConfig[] {
  return items.filter(
    (item): item is DropdownItemConfig => !!item && item.visible !== false
  );
}

// Renderers

function ToggleItem({ item }: { item: ToggleItemConfig }) {
  const Icon = item.icon;
  return (
    <div className="flex min-h-[32px] items-center justify-between px-2 py-1.5">
      <div className="flex items-center gap-2">
        {Icon && <Icon className="text-muted-foreground h-4 w-4" />}
        <span className="text-sm">{item.label}</span>
      </div>
      <Switch
        checked={item.checked}
        onCheckedChange={item.onChange}
        className="scale-75"
        disabled={item.disabled}
      />
    </div>
  );
}

function MenuItem({ item }: { item: MenuItemConfig }) {
  const Icon = item.icon;
  return (
    <DropdownMenuItem
      onClick={item.onClick}
      disabled={item.disabled}
      className={cn(
        item.variant === "destructive" &&
          "text-destructive focus:text-destructive"
      )}
    >
      {Icon && <Icon className="mr-2 h-4 w-4" />}
      {item.label}
    </DropdownMenuItem>
  );
}

function SubmenuItem({ item }: { item: SubmenuItemConfig }) {
  const Icon = item.icon;
  const visibleItems = filterVisibleItems(item.items);

  if (visibleItems.length === 0) return null;

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={item.disabled}>
        {Icon && <Icon className="mr-2 h-4 w-4" />}
        {item.label}
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent>
          {visibleItems.map((subItem, index) => (
            <DropdownItemRenderer
              key={subItem.key ?? `sub-${index}`}
              item={subItem}
            />
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}

function DropdownItemRenderer({ item }: { item: DropdownItemConfig }) {
  switch (item.type) {
    case "item":
      return <MenuItem item={item} />;
    case "toggle":
      return <ToggleItem item={item} />;
    case "submenu":
      return <SubmenuItem item={item} />;
    case "separator":
      return <DropdownMenuSeparator />;
    case "custom":
      return <>{item.render()}</>;
    default:
      return null;
  }
}

// Main Component

export function ADropdownMenu({
  trigger,
  items,
  align = "end",
  minWidth = "180px",
  className,
}: ADropdownMenuProps) {
  const visibleItems = filterVisibleItems(items);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        className={className}
        style={{ minWidth }}
      >
        {visibleItems.map((item, index) => (
          <DropdownItemRenderer key={item.key ?? index} item={item} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Factory Functions

export function menuItem(
  label: string,
  onClick: () => void,
  options?: Partial<Omit<MenuItemConfig, "type" | "label" | "onClick">>
): MenuItemConfig {
  return { type: "item", label, onClick, ...options };
}

export function toggleItem(
  label: string,
  checked: boolean,
  onChange: () => void,
  options?: Partial<
    Omit<ToggleItemConfig, "type" | "label" | "checked" | "onChange">
  >
): ToggleItemConfig {
  return { type: "toggle", label, checked, onChange, ...options };
}

export function submenuItem(
  label: string,
  items: DropdownItemConfig[],
  options?: Partial<Omit<SubmenuItemConfig, "type" | "label" | "items">>
): SubmenuItemConfig {
  return { type: "submenu", label, items, ...options };
}

export function separator(
  options?: Partial<Omit<SeparatorItemConfig, "type">>
): SeparatorItemConfig {
  return { type: "separator", ...options };
}

export function customItem(
  render: () => ReactNode,
  options?: Partial<Omit<CustomItemConfig, "type" | "render">>
): CustomItemConfig {
  return { type: "custom", render, ...options };
}
