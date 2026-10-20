"use client";

import { useState } from "react";
import { Check, Folder, Plus, X } from "lucide-react";
import { useSessionsQuery } from "@/data/sessions";
import { useAssignGroup, useCreateGroup } from "@/data/session-groups";
import { Input } from "@/components/ui/input";
import { Expander, MenuItem, icon, type MenuKind } from "./RowMenuParts";

// "Move to group": the groups of the session's workspace with the current
// one ticked, a way out, and an inline field that makes a new group and
// files the session into it.
export function MoveToGroupMenu({
  kind,
  sessionId,
  groupId,
  workspaceId,
}: {
  kind: MenuKind;
  sessionId: string;
  groupId: string | null | undefined;
  workspaceId: string | null;
}) {
  const { data } = useSessionsQuery();
  const assign = useAssignGroup();
  const create = useCreateGroup();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const groups = (data?.sessionGroups ?? [])
    .filter((g) => g.workspace_id === workspaceId)
    .sort((a, b) => a.sort_order - b.sort_order);

  const make = async () => {
    const next = name.trim();
    if (!next) return;
    const { sessionGroup } = await create.mutateAsync({
      name: next,
      workspaceId,
    });
    assign.mutate({ ids: [sessionId], groupId: sessionGroup.id });
    setNaming(false);
    setName("");
  };

  return (
    <Expander kind={kind} icon={Folder} label="Move to group">
      {groups.map((g) => (
        <MenuItem
          key={g.id}
          kind={kind}
          onClick={() =>
            assign.mutate({
              ids: [sessionId],
              groupId: g.id === groupId ? null : g.id,
            })
          }
        >
          <Check className={`${icon} ${g.id === groupId ? "" : "invisible"}`} />
          <span className="truncate">{g.name}</span>
        </MenuItem>
      ))}
      {groupId && (
        <MenuItem
          kind={kind}
          onClick={() => assign.mutate({ ids: [sessionId], groupId: null })}
        >
          <X className={icon} />
          Remove from group
        </MenuItem>
      )}
      {naming ? (
        <div className="px-1.5 py-1">
          <Input
            autoFocus
            value={name}
            maxLength={60}
            placeholder="Group name"
            aria-label="New group name"
            className="h-11 md:h-8"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              // Keys here are typing, not the menu's typeahead.
              e.stopPropagation();
              if (e.key === "Enter") void make();
            }}
          />
          <p className="text-muted-foreground/70 px-1 pt-1 text-[11px]">
            ↵ create
          </p>
        </div>
      ) : (
        <MenuItem
          kind={kind}
          onSelect={(e) => {
            e.preventDefault();
            setNaming(true);
          }}
        >
          <Plus className={icon} />
          New group…
        </MenuItem>
      )}
    </Expander>
  );
}
