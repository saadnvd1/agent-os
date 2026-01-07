"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Plus } from "lucide-react";
import type { Group } from "@/lib/db";

interface NewSessionDialogProps {
  open: boolean;
  groups: Group[];
  onClose: () => void;
  onCreated: (sessionId: string) => void;
  onCreateGroup?: (name: string, parentPath?: string) => Promise<void>;
}

export function NewSessionDialog({
  open,
  groups,
  onClose,
  onCreated,
  onCreateGroup,
}: NewSessionDialogProps) {
  const [name, setName] = useState("");
  const [workingDirectory, setWorkingDirectory] = useState("~");
  const [groupPath, setGroupPath] = useState("sessions");
  const [isLoading, setIsLoading] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setIsLoading(true);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || undefined, // Let API auto-generate if empty
          workingDirectory,
          groupPath,
        }),
      });

      const data = await res.json();
      if (data.session) {
        setName("");
        setWorkingDirectory("~");
        setGroupPath("sessions");
        onCreated(data.session.id);
      }
    } catch (error) {
      console.error("Failed to create session:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim() || !onCreateGroup) return;
    await onCreateGroup(newGroupName.trim());
    setNewGroupName("");
    setShowNewGroup(false);
  };

  const handleClose = () => {
    setName("");
    setWorkingDirectory("~");
    setGroupPath("sessions");
    setShowNewGroup(false);
    setNewGroupName("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Session</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Name <span className="text-muted-foreground font-normal">(optional)</span></label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Auto-generated if empty"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Working Directory</label>
            <Input
              value={workingDirectory}
              onChange={(e) => setWorkingDirectory(e.target.value)}
              placeholder="~/projects/my-app"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Group</label>
            {showNewGroup ? (
              <div className="flex gap-2">
                <Input
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="New group name"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleCreateGroup();
                    } else if (e.key === "Escape") {
                      setShowNewGroup(false);
                      setNewGroupName("");
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCreateGroup}
                  disabled={!newGroupName.trim()}
                >
                  Add
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowNewGroup(false);
                    setNewGroupName("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Select value={groupPath} onValueChange={setGroupPath}>
                  <SelectTrigger className="flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {groups.map((group) => (
                      <SelectItem key={group.path} value={group.path}>
                        {group.path === "sessions" ? group.name : group.path.replace(/\//g, " / ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {onCreateGroup && (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setShowNewGroup(true)}
                    title="Create new group"
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
