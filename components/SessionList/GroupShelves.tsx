"use client";

import { useState } from "react";
import { ChevronDown, Folder, MoreHorizontal } from "lucide-react";
import type { GroupShelf } from "@/lib/sidebar/shelves";
import {
  useDeleteGroup,
  useReorderGroups,
  useUpdateGroup,
} from "@/data/session-groups";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { SessionRow } from "./SessionRow";

function GroupHeader({
  shelf,
  siblings,
  workspaceName,
}: {
  shelf: GroupShelf;
  siblings: GroupShelf[];
  workspaceName?: string;
}) {
  const { group, rows, rollup } = shelf;
  const update = useUpdateGroup();
  const reorder = useReorderGroups();
  const remove = useDeleteGroup();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(group.name);
  const at = siblings.findIndex((s) => s.group.id === group.id);
  const move = (by: -1 | 1) => {
    const ids = siblings.map((s) => s.group.id);
    ids.splice(at + by, 0, ids.splice(at, 1)[0]);
    reorder.mutate({ workspaceId: group.workspace_id, ids });
  };
  const commit = () => {
    const next = name.trim();
    setRenaming(false);
    if (next && next !== group.name)
      update.mutate({ id: group.id, name: next });
    else setName(group.name);
  };

  if (renaming)
    return (
      <div className="px-2.5 pt-3.5 pb-1.5">
        <Input
          autoFocus
          value={name}
          maxLength={60}
          aria-label="Group name"
          className="h-11 md:h-8"
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setName(group.name);
              setRenaming(false);
            }
          }}
        />
      </div>
    );

  return (
    <div className="text-muted-foreground/70 group/header flex items-center pr-1 pl-2.5">
      <button
        type="button"
        onClick={() =>
          update.mutate({ id: group.id, collapsed: !group.collapsed })
        }
        aria-expanded={!group.collapsed}
        className="hover:text-foreground flex min-h-11 min-w-0 flex-1 items-center gap-1 pt-2 text-left text-[11px] font-medium tracking-[0.08em] uppercase md:min-h-8"
      >
        <Folder aria-hidden className="h-3 w-3 shrink-0" />
        <span className="truncate">{group.name}</span>
        <span className="shrink-0">· {rows.length}</span>
        {rollup.needsYou > 0 && (
          <span className="shrink-0 text-amber-600 normal-case dark:text-amber-400">
            · {rollup.needsYou} needs you
          </span>
        )}
        {workspaceName && (
          <span className="bg-muted text-muted-foreground ml-1 truncate rounded px-1.5 py-0.5 text-[10px] normal-case">
            {workspaceName}
          </span>
        )}
        <ChevronDown
          aria-hidden
          className={cn(
            "h-3 w-3 shrink-0 transition-transform",
            group.collapsed && "-rotate-90"
          )}
        />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`${group.name} options`}
            className="hover:bg-muted flex h-11 w-11 shrink-0 items-center justify-center rounded-md md:h-8 md:w-8 md:opacity-0 md:group-hover/header:opacity-100 md:focus-visible:opacity-100 md:data-[state=open]:opacity-100 [@media(hover:none)]:md:h-11 [@media(hover:none)]:md:w-11 [@media(hover:none)]:md:opacity-100"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem
            className="min-h-11 md:min-h-8"
            onSelect={() => setRenaming(true)}
          >
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            className="min-h-11 md:min-h-8"
            disabled={at <= 0}
            onSelect={() => move(-1)}
          >
            Move up
          </DropdownMenuItem>
          <DropdownMenuItem
            className="min-h-11 md:min-h-8"
            disabled={at < 0 || at >= siblings.length - 1}
            onSelect={() => move(1)}
          >
            Move down
          </DropdownMenuItem>
          <DropdownMenuItem
            className="min-h-11 md:min-h-8"
            onSelect={() =>
              update.mutate({ id: group.id, collapsed: !group.collapsed })
            }
          >
            {group.collapsed ? "Unfold" : "Fold"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            className="min-h-11 md:min-h-8"
            onSelect={() => remove.mutate({ id: group.id, name: group.name })}
          >
            Delete group
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// The user's groups, in order, between Pinned and the status shelves. A
// folded group keeps its header and counts; an auto-settled member is muted.
export function GroupShelves({
  groups,
  workspaceNames,
}: {
  groups: GroupShelf[];
  // Set when more than one workspace's groups show, to tag each header.
  workspaceNames?: Map<string, string>;
}) {
  return groups.map((shelf) => {
    const { group } = shelf;
    const siblings = groups.filter(
      (g) => g.group.workspace_id === group.workspace_id
    );
    const empty = !group.collapsed && shelf.rows.length === 0;
    return (
      <section key={group.id} aria-label={group.name}>
        <GroupHeader
          shelf={shelf}
          siblings={siblings}
          workspaceName={
            workspaceNames && group.workspace_id
              ? workspaceNames.get(group.workspace_id)
              : undefined
          }
        />
        {empty && (
          <p className="text-muted-foreground/70 px-2.5 pb-2 text-xs">
            Nothing here yet · move a session in from its ⋯ menu
          </p>
        )}
        {(group.collapsed ? [] : shelf.rows).map((r) => (
          <SessionRow key={r.session.id} row={r} muted={r.settled === "auto"} />
        ))}
      </section>
    );
  });
}
