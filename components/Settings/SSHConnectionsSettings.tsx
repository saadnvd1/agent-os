"use client";

import { useState } from "react";
import {
  useSSHConnectionsQuery,
  useCreateSSHConnection,
  useDeleteSSHConnection,
  useTestSSHConnection,
} from "@/data/ssh-connections";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Plus, Trash2, Activity, Server, Check, X, Loader2 } from "lucide-react";
import type { SSHConnection } from "@/lib/db/types";

export function SSHConnectionsSettings() {
  const { data: connections, isPending } = useSSHConnectionsQuery();
  const [showDialog, setShowDialog] = useState(false);

  if (isPending) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">SSH Connections</h2>
          <p className="text-sm text-muted-foreground">
            Manage SSH connections for remote projects
          </p>
        </div>
        <Button onClick={() => setShowDialog(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Connection
        </Button>
      </div>

      {connections && connections.length === 0 ? (
        <Card className="flex flex-col items-center justify-center border-dashed p-8">
          <Server className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground text-center text-sm">
            No SSH connections yet. Add one to enable remote projects.
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {connections?.map((conn) => (
            <SSHConnectionCard key={conn.id} connection={conn} />
          ))}
        </div>
      )}

      <SSHConnectionDialog open={showDialog} onOpenChange={setShowDialog} />
    </div>
  );
}

function SSHConnectionCard({ connection }: { connection: SSHConnection }) {
  const deleteMutation = useDeleteSSHConnection();
  const testMutation = useTestSSHConnection();
  const [testResult, setTestResult] = useState<{
    success: boolean;
    dependencies?: { tmux: boolean; git: boolean; claude?: boolean };
  } | null>(null);

  const handleTest = async () => {
    try {
      const result = await testMutation.mutateAsync(connection.id);
      setTestResult(result);
      if (result.success) {
        toast.success("Connection successful!");
      } else {
        toast.error("Connection failed");
      }
    } catch (error: unknown) {
      const err = error as { message?: string };
      toast.error(err.message || "Connection test failed");
      setTestResult({ success: false });
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete SSH connection "${connection.name}"?`)) return;
    try {
      await deleteMutation.mutateAsync(connection.id);
      toast.success("Connection deleted");
    } catch (error: unknown) {
      const err = error as { message?: string };
      toast.error(err.message || "Failed to delete connection");
    }
  };

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <Server className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{connection.name}</p>
            <p className="text-sm text-muted-foreground truncate">
              {connection.user}@{connection.host}:{connection.port}
            </p>
            {connection.key_path && (
              <p className="text-xs text-muted-foreground truncate">
                Key: {connection.key_path}
              </p>
            )}

            {/* Test Results */}
            {testResult && (
              <div className="mt-2 space-y-1">
                <div
                  className={`flex items-center gap-1 text-xs ${
                    testResult.success ? "text-green-600" : "text-red-600"
                  }`}
                >
                  {testResult.success ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <X className="h-3 w-3" />
                  )}
                  {testResult.success ? "Connected" : "Connection failed"}
                </div>
                {testResult.dependencies && (
                  <div className="flex gap-3 text-xs">
                    <span
                      className={
                        testResult.dependencies.tmux
                          ? "text-green-600"
                          : "text-red-600"
                      }
                    >
                      tmux: {testResult.dependencies.tmux ? "✓" : "✗"}
                    </span>
                    <span
                      className={
                        testResult.dependencies.git
                          ? "text-green-600"
                          : "text-red-600"
                      }
                    >
                      git: {testResult.dependencies.git ? "✓" : "✗"}
                    </span>
                    {testResult.dependencies.claude !== undefined && (
                      <span
                        className={
                          testResult.dependencies.claude
                            ? "text-green-600"
                            : "text-muted-foreground"
                        }
                      >
                        claude: {testResult.dependencies.claude ? "✓" : "✗"}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleTest}
            disabled={testMutation.isPending}
            title="Test connection"
          >
            {testMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Activity className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
            className="text-red-500 hover:text-red-600"
            title="Delete connection"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
}

function SSHConnectionDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createMutation = useCreateSSHConnection();
  const [formData, setFormData] = useState({
    name: "",
    host: "",
    port: 22,
    user: "",
    key_path: "~/.ssh/id_ed25519",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createMutation.mutateAsync(formData);
      toast.success("SSH connection created and tested successfully!");
      onOpenChange(false);
      // Reset form
      setFormData({
        name: "",
        host: "",
        port: 22,
        user: "",
        key_path: "~/.ssh/id_ed25519",
      });
    } catch (error: unknown) {
      const err = error as { message?: string };
      toast.error(err.message || "Failed to create connection");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add SSH Connection</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium">Connection Name</label>
            <Input
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="My Dev Server"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Host</label>
            <Input
              required
              value={formData.host}
              onChange={(e) => setFormData({ ...formData, host: e.target.value })}
              placeholder="192.168.1.100 or example.com"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Port</label>
              <Input
                type="number"
                value={formData.port}
                onChange={(e) =>
                  setFormData({ ...formData, port: parseInt(e.target.value) })
                }
              />
            </div>
            <div>
              <label className="text-sm font-medium">Username</label>
              <Input
                required
                value={formData.user}
                onChange={(e) =>
                  setFormData({ ...formData, user: e.target.value })
                }
                placeholder="ubuntu"
              />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">SSH Key Path</label>
            <Input
              required
              value={formData.key_path}
              onChange={(e) =>
                setFormData({ ...formData, key_path: e.target.value })
              }
            />
            <p className="text-xs text-muted-foreground mt-1">
              Make sure your key is added to ssh-agent:{" "}
              <code className="bg-muted px-1 py-0.5 rounded">
                ssh-add {formData.key_path}
              </code>
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Creating..." : "Create Connection"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
