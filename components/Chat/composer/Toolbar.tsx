"use client";

import { useRef, useState } from "react";
import {
  ArrowUp,
  ImagePlus,
  ListChecks,
  MonitorUp,
  Square,
  Type,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ChatAccess, ChatModel } from "@/lib/chat/events";
import { cn } from "@/lib/utils";
import {
  canCaptureScreen,
  captureScreenFrame,
} from "@/lib/client/screen-capture";
import { AccessPicker } from "../AccessPicker";
import { ModelPicker } from "../ModelPicker";

export function Toolbar({
  plain,
  onTogglePlain,
  onAddImages,
  plan,
  onTogglePlan,
  accessory,
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
  onAddImages: (files: Iterable<File>) => void;
  // Plan mode, when the session can use it.
  plan?: boolean | null;
  onTogglePlan?: () => void;
  // Shown in the free space before the send button (the phone's meter).
  accessory?: React.ReactNode;
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
  // The composer renders in the browser only, so this can be asked now.
  const [canCapture] = useState(canCaptureScreen);
  const capture = async () => {
    try {
      const file = await captureScreenFrame();
      if (file) onAddImages([file]);
    } catch (error) {
      toast.error(
        `Couldn't capture the screen: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };
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
      {canCapture && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Capture screen"
          title="Attach a screenshot of a screen or window"
          className="h-10 w-10 shrink-0"
          onClick={() => void capture()}
        >
          <MonitorUp className="h-4 w-4" />
        </Button>
      )}
      {onTogglePlan && typeof plan === "boolean" && (
        <button
          type="button"
          aria-label="Plan mode"
          aria-pressed={plan}
          title={`Plan mode ${plan ? "on" : "off"} (Shift+Tab)`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onTogglePlan}
          className={cn(
            "flex h-10 shrink-0 items-center gap-1 rounded-lg px-2 text-xs",
            plan
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05]"
          )}
        >
          <ListChecks className="h-3.5 w-3.5" />
          <span className={plan ? "" : "hidden sm:inline"}>Plan</span>
        </button>
      )}
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
      {accessory}
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
