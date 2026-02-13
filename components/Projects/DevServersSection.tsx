import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Loader2, RefreshCw, Server } from "lucide-react";
import type { DevServerConfig } from "./NewProjectDialog.types";

interface DevServersSectionProps {
  devServers: DevServerConfig[];
  isDetecting: boolean;
  workingDirectory: string;
  onDetect: () => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, updates: Partial<DevServerConfig>) => void;
}

export function DevServersSection({
  devServers,
  isDetecting,
  workingDirectory,
  onDetect,
  onAdd,
  onRemove,
  onUpdate,
}: DevServersSectionProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm font-medium">
          <Server className="h-4 w-4" />
          Dev Servers
        </label>
        <div className="flex gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onDetect}
            disabled={
              isDetecting || !workingDirectory || workingDirectory === "~"
            }
          >
            {isDetecting ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 h-3 w-3" />
            )}
            Detect
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onAdd}>
            <Plus className="mr-1 h-3 w-3" />
            Add
          </Button>
        </div>
      </div>

      {devServers.length === 0 ? (
        <p className="text-muted-foreground py-2 text-sm">
          No dev servers configured. Click Detect to auto-find or Add to
          configure manually.
        </p>
      ) : (
        <div className="space-y-2">
          {devServers.map((ds) => (
            <div key={ds.id} className="bg-accent/30 space-y-2 rounded-lg p-3">
              <div className="flex items-center gap-2">
                <Input
                  value={ds.name}
                  onChange={(e) => onUpdate(ds.id, { name: e.target.value })}
                  placeholder="Server name"
                  className="h-8 flex-1"
                />
                <Select
                  value={ds.type}
                  onValueChange={(v) =>
                    onUpdate(ds.id, { type: v as "node" | "docker" })
                  }
                >
                  <SelectTrigger className="h-8 w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="node">Node</SelectItem>
                    <SelectItem value="docker">Docker</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onRemove(ds.id)}
                  className="text-red-500 hover:text-red-600"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
              <Input
                value={ds.command}
                onChange={(e) => onUpdate(ds.id, { command: e.target.value })}
                placeholder={
                  ds.type === "docker" ? "Service name" : "npm run dev"
                }
                className="h-8"
              />
              <div className="flex gap-2">
                <Input
                  type="number"
                  value={ds.port || ""}
                  onChange={(e) =>
                    onUpdate(ds.id, {
                      port: e.target.value
                        ? parseInt(e.target.value)
                        : undefined,
                    })
                  }
                  placeholder="Port (e.g., 3000)"
                  className="h-8 w-32"
                />
                <Input
                  value={ds.portEnvVar || ""}
                  onChange={(e) =>
                    onUpdate(ds.id, { portEnvVar: e.target.value })
                  }
                  placeholder="Port env var (e.g., PORT)"
                  className="h-8 flex-1"
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
