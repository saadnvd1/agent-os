"use client";

import { useRef, useState } from "react";
import {
  ArrowUp,
  Folder,
  GitFork,
  Paperclip,
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
  onAddFiles,
  accept,
  plan,
  onTogglePlan,
  accessory,
  access,
  onSetAccess,
  models,
  model,
  modelLabel,
  agentName,
  onSetModel,
  modelOpen,
  onModelOpenChange,
  stop,
  onStop,
  canSend,
  onSend,
  sendLabel = "Send",
  fork,
}: {
  plain: boolean;
  onTogglePlain: () => void;
  onAddFiles: (files: Iterable<File>) => void;
  // The types the server takes, for the picker.
  accept: string;
  // Plan mode, when the session can use it.
  plan?: boolean | null;
  onTogglePlan?: () => void;
  // Shown in the free space before the send button (the phone's meter).
  accessory?: React.ReactNode;
  access?: ChatAccess;
  onSetAccess?: (access: ChatAccess) => void;
  models: ChatModel[];
  model: string;
  modelLabel?: string;
  agentName?: string;
  onSetModel?: (model: string) => void;
  modelOpen: boolean;
  onModelOpenChange: (open: boolean) => void;
  stop: boolean;
  onStop: () => void;
  canSend: boolean;
  onSend: () => void;
  sendLabel?: string;
  // Fork mode: the own-checkout choice, and a send button that says what it does.
  fork?: { own: boolean; onOwn: () => void };
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const formatting = plain ? "Formatting off" : "Formatting on";
  // The composer renders in the browser only, so this can be asked now.
  const [canCapture] = useState(canCaptureScreen);
  const capture = async () => {
    try {
      const file = await captureScreenFrame();
      if (file) onAddFiles([file]);
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
        aria-label="Attach files"
        className="h-10 w-10 shrink-0"
        onClick={() => fileRef.current?.click()}
      >
        <Paperclip className="h-4 w-4" />
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept={accept}
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) onAddFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {canCapture && !fork && (
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
      {fork && (
        <button
          type="button"
          aria-pressed={fork.own}
          title="Own checkout lets the fork edit code; off, it reads this checkout and leaves it alone"
          onMouseDown={(e) => e.preventDefault()}
          onClick={fork.onOwn}
          className={cn(
            "flex h-10 shrink-0 items-center gap-1 rounded-lg px-2 text-xs",
            fork.own
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05]"
          )}
        >
          <Folder className="h-3.5 w-3.5" />
          {fork.own ? "Own checkout" : "Reads only"}
        </button>
      )}
      {!fork && onSetAccess && access && (
        <AccessPicker access={access} onPick={onSetAccess} />
      )}
      {!fork && onSetModel && (
        <ModelPicker
          models={models}
          model={model}
          label={modelLabel}
          agentName={agentName}
          open={modelOpen}
          onOpenChange={onModelOpenChange}
          onPick={onSetModel}
        />
      )}
      <span className="flex-1" />
      {!fork && accessory}
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
          aria-label={sendLabel}
          title={sendLabel}
          className={cn(
            "h-10 shrink-0 rounded-xl",
            fork ? "w-auto gap-1.5 px-3.5" : "w-10"
          )}
          disabled={!canSend}
          // Tapping send mustn't blur the editor and drop the keyboard.
          onMouseDown={(e) => e.preventDefault()}
          onClick={onSend}
        >
          {fork ? (
            <>
              <GitFork className="h-3.5 w-3.5" />
              Start fork
            </>
          ) : (
            <ArrowUp className="h-4 w-4" />
          )}
        </Button>
      )}
    </div>
  );
}
