"use client";

import { useMemo, useRef, useState } from "react";
import { ArrowUp, ImagePlus, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ChatCommand, ChatImage, ChatModel } from "@/lib/chat/events";
import { insertCommand, rankCommands, slashQuery } from "@/lib/chat/commands";
import { CommandMenu } from "./CommandMenu";
import { ModelPicker } from "./ModelPicker";

const MAX_HEIGHT = 200;

// Handled here rather than sent: picking it opens the model picker.
const MODEL_COMMAND: ChatCommand = {
  name: "model",
  description: "Switch the model for this conversation",
};

function readImage(file: File): Promise<ChatImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const [meta, data] = String(reader.result).split(",");
      resolve({ mediaType: meta.slice(5, meta.indexOf(";")), data });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Enter sends on a keyboard; on touch screens it's a newline and the button sends.
const coarsePointer = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(pointer: coarse)").matches;

export function Composer({
  running,
  disabled,
  placeholder,
  onSend,
  onStop,
  commands = [],
  models = [],
  model = "",
  onSetModel,
}: {
  running: boolean;
  disabled?: boolean;
  placeholder: string;
  onSend: (text: string, images: ChatImage[]) => void;
  onStop: () => void;
  commands?: ChatCommand[];
  models?: ChatModel[];
  model?: string;
  onSetModel?: (model: string) => void;
}) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<ChatImage[]>([]);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const query = slashQuery(text);
  const matches = useMemo(() => {
    if (query === null) return [];
    const all = [
      ...(onSetModel ? [MODEL_COMMAND] : []),
      ...commands.filter((c) => c.name !== "model"),
    ];
    return rankCommands(query, all);
  }, [query, commands, onSetModel]);
  const menuOpen = query !== null && dismissed !== text;
  const highlighted = Math.min(active, Math.max(matches.length - 1, 0));

  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  };

  const update = (value: string) => {
    setText(value);
    setActive(0);
    requestAnimationFrame(resize);
  };

  const pick = (command: ChatCommand) => {
    if (command === MODEL_COMMAND) {
      update("");
      setModelOpen(true);
      return;
    }
    update(insertCommand(command.name));
    ref.current?.focus();
  };

  const addFiles = async (files: Iterable<File>) => {
    const picked = [...files].filter((f) => f.type.startsWith("image/"));
    const read = await Promise.all(picked.map(readImage));
    setImages((prev) => [...prev, ...read]);
  };

  const submit = () => {
    if (!text.trim() && !images.length) return;
    onSend(text, images);
    setImages([]);
    update("");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuOpen && matches.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        setActive((highlighted + step + matches.length) % matches.length);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        pick(matches[highlighted]);
        return;
      }
    }
    if (menuOpen && e.key === "Escape") {
      e.preventDefault();
      setDismissed(text);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !coarsePointer()) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="relative">
      {menuOpen && (
        <CommandMenu
          commands={matches}
          active={highlighted}
          onPick={pick}
          onHover={setActive}
        />
      )}
      <div className="bg-card popover-surface rounded-2xl p-2">
        {images.length > 0 && (
          <div className="flex flex-wrap gap-2 px-1 pb-2">
            {images.map((img, i) => (
              <div key={i} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`data:${img.mediaType};base64,${img.data}`}
                  alt=""
                  className="h-14 w-14 rounded-lg object-cover"
                />
                <button
                  type="button"
                  aria-label="Remove image"
                  onClick={() => setImages(images.filter((_, j) => j !== i))}
                  className="bg-background absolute -top-1.5 -right-1.5 rounded-full p-0.5 shadow"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={ref}
          aria-label="Message"
          value={text}
          rows={1}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => update(e.target.value)}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.some((f) => f.type.startsWith("image/"))) {
              e.preventDefault();
              void addFiles(files);
            }
          }}
          onKeyDown={onKeyDown}
          className="placeholder:text-muted-foreground block min-h-10 w-full resize-none bg-transparent px-2 py-2 text-base outline-none md:text-sm"
        />
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
              if (e.target.files) void addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          {onSetModel && (
            <ModelPicker
              models={models}
              model={model}
              open={modelOpen}
              onOpenChange={setModelOpen}
              onPick={onSetModel}
            />
          )}
          <span className="flex-1" />
          {running && !text.trim() && !images.length ? (
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
              disabled={disabled || (!text.trim() && !images.length)}
              onClick={submit}
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
