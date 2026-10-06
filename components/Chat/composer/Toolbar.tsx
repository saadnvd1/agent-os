"use client";

import { useRef } from "react";
import { ArrowUp, ImagePlus, Square, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ChatAccess, ChatModel } from "@/lib/chat/events";
import { cn } from "@/lib/utils";
import { AccessPicker } from "../AccessPicker";
import { ModelPicker } from "../ModelPicker";

export function Toolbar({
  plain,
  onTogglePlain,
  onAddImages,
  access,
  onSetAccess,
  models,
  model,
  onSetModel,
  modelOpen,
  onModelOpenChange,
  stop,
  onStop,
  canSend,
  onSend,
}: {
  plain: boolean;
  onTogglePlain: () => void;
  onAddImages: (files: FileList) => void;
  access?: ChatAccess;
  onSetAccess?: (access: ChatAccess) => void;
  models: ChatModel[];
  model: string;
  onSetModel?: (model: string) => void;
  modelOpen: boolean;
  onModelOpenChange: (open: boolean) => void;
  stop: boolean;
  onStop: () => void;
  canSend: boolean;
  onSend: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const formatting = plain ? "Formatting off" : "Formatting on";
  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Attach image"
        className="h-10 w-10 shrink-0"
        onClick={() => fileRef.current?.click()}
      >
        <ImagePlus className="h-4 w-4" />
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) onAddImages(e.target.files);
          e.target.value = "";
        }}
      />
      {onSetAccess && access && (
        <AccessPicker access={access} onPick={onSetAccess} />
      )}
      {onSetModel && (
        <ModelPicker
          models={models}
          model={model}
          open={modelOpen}
          onOpenChange={onModelOpenChange}
          onPick={onSetModel}
        />
      )}
      <span className="flex-1" />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Live formatting"
        aria-pressed={!plain}
        title={`${formatting} (Cmd/Ctrl+/)`}
        // Keep focus in the editor so the keyboard stays up on phones.
        onMouseDown={(e) => e.preventDefault()}
        onClick={onTogglePlain}
        className={cn(
          "h-10 w-10 shrink-0",
          plain ? "text-muted-foreground/60" : "text-primary"
        )}
      >
        <Type className="h-4 w-4" />
      </Button>
      {stop ? (
        <Button
          type="button"
          size="icon"
          variant="secondary"
          aria-label="Stop"
          className="h-10 w-10 shrink-0"
          onClick={onStop}
        >
          <Square className="h-3.5 w-3.5 fill-current" />
        </Button>
      ) : (
        <Button
          type="button"
          size="icon"
          aria-label="Send"
          className="h-10 w-10 shrink-0 rounded-xl"
          disabled={!canSend}
          // Tapping send mustn't blur the editor and drop the keyboard.
          onMouseDown={(e) => e.preventDefault()}
          onClick={onSend}
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
