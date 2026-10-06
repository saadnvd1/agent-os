"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent } from "@tiptap/react";
import type {
  ChatAccess,
  ChatCommand,
  ChatImage,
  ChatModel,
} from "@/lib/chat/events";
import {
  attachmentName,
  composeMessage,
  type TextAttachment,
} from "@/lib/chat/paste";
import { insertCommand, rankCommands, slashQuery } from "@/lib/chat/commands";
import { cn } from "@/lib/utils";
import { loadDraft, useSaveDraft } from "./useDraft";
import { CommandMenu } from "./CommandMenu";
import { Attachments } from "./composer/Attachments";
import { Toolbar } from "./composer/Toolbar";
import { useImageDrop } from "./composer/useImageDrop";
import type { MenuKey } from "./composer/keys";
import {
  useComposerEditor,
  type ComposerHandlers,
} from "./composer/useComposerEditor";

// Handled here rather than sent: picking it opens the model picker.
const MODEL_COMMAND: ChatCommand = {
  name: "model",
  description: "Switch the model for this conversation",
};

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
  access,
  onSetAccess,
  prefill,
  draftKey,
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
  access?: ChatAccess;
  onSetAccess?: (access: ChatAccess) => void;
  // Text to put back in the composer (an undone message), once per `at`.
  prefill?: { text: string; at: number };
  // Saves what's typed under this key, so a reload doesn't lose it.
  draftKey?: string;
}) {
  const [images, setImages] = useState<ChatImage[]>([]);
  const [files, setFiles] = useState<TextAttachment[]>([]);
  // The highlighted command, for the text it was picked on: typing resets it.
  const [active, setActiveAt] = useState({ text: "", index: 0 });
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const handlers = useRef<ComposerHandlers | null>(null);
  const { editor, text, setText, plain, setPlain } = useComposerEditor({
    placeholder,
    disabled,
    handlers,
  });

  const draft = useMemo(() => ({ text, images, files }), [text, images, files]);
  useSaveDraft(draftKey, draft);

  // Restored once the editor exists (the server render has no access to this
  // browser), and once per key: toggling plain mode makes a new editor.
  const restored = useRef<string | null>(null);
  useEffect(() => {
    if (!draftKey || !editor || restored.current === draftKey) return;
    restored.current = draftKey;
    const saved = loadDraft(draftKey);
    setText(saved?.text ?? "");
    setImages(saved?.images ?? []);
    setFiles(saved?.files ?? []);
  }, [draftKey, editor, setText]);

  const prefilled = useRef<number | null>(null);
  useEffect(() => {
    if (!prefill || !editor || prefilled.current === prefill.at) return;
    prefilled.current = prefill.at;
    setText(prefill.text, true);
  }, [prefill, editor, setText]);

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
  const setActive = (index: number) => setActiveAt({ text, index });
  const highlighted = Math.min(
    active.text === text ? active.index : 0,
    Math.max(matches.length - 1, 0)
  );

  const pick = (command: ChatCommand) => {
    if (command === MODEL_COMMAND) {
      setText("");
      setModelOpen(true);
      return;
    }
    setText(insertCommand(command.name), true);
  };

  const { dragging, dropProps, addFiles } = useImageDrop((read) =>
    setImages((prev) => [...prev, ...read])
  );

  const empty = !text.trim() && !images.length && !files.length;
  const submit = () => {
    if (empty || disabled) return;
    onSend(composeMessage(text, files), images);
    setImages([]);
    setFiles([]);
    setText("");
  };

  const onMenuKey = (key: MenuKey) => {
    if (key === "close") setDismissed(text);
    else if (key === "pick") pick(matches[highlighted]);
    else
      setActive(
        (highlighted + (key === "down" ? 1 : -1) + matches.length) %
          matches.length
      );
  };

  useEffect(() => {
    handlers.current = {
      menuOpen,
      menuHasMatches: matches.length > 0,
      onMenuKey,
      onSend: submit,
      onImages: (picked) => void addFiles(picked),
      onLongPaste: (pasted, language) =>
        setFiles((prev) => [
          ...prev,
          { name: attachmentName(prev), text: pasted, language },
        ]),
    };
  });

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
      <div
        {...dropProps}
        className={cn(
          "bg-card popover-surface rounded-2xl p-2 transition-shadow",
          dragging && "ring-primary ring-2"
        )}
      >
        <Attachments
          images={images}
          files={files}
          onRemoveImage={(i) => setImages(images.filter((_, j) => j !== i))}
          onRemoveFile={(i) => setFiles(files.filter((_, j) => j !== i))}
        />
        <div className="chat-composer max-h-[200px] overflow-y-auto overscroll-contain">
          <EditorContent editor={editor} />
        </div>
        <Toolbar
          plain={plain}
          onTogglePlain={() => setPlain(!plain)}
          onAddImages={(picked) => void addFiles(picked)}
          access={access}
          onSetAccess={onSetAccess}
          models={models}
          model={model}
          onSetModel={onSetModel}
          modelOpen={modelOpen}
          onModelOpenChange={setModelOpen}
          stop={running && empty}
          onStop={onStop}
          canSend={!disabled && !empty}
          onSend={submit}
        />
      </div>
    </div>
  );
}
