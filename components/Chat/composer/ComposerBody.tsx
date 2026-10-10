"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent } from "@tiptap/react";
import { CornerDownRight, File, Folder } from "lucide-react";
import type {
  ChatAccess,
  ChatCommand,
  ChatImage,
  ChatModel,
  FileSuggestion,
} from "@/lib/chat/events";
import {
  nextAttachment,
  composeMessage,
  type TextAttachment,
} from "@/lib/chat/paste";
import { insertCommand, rankCommands, slashQuery } from "@/lib/chat/commands";
import { cn } from "@/lib/utils";
import { loadDraft, useSaveDraft } from "../useDraft";
import { ComposerMenu, type MenuOption } from "../ComposerMenu";
import { offeredSuggestion } from "@/lib/chat/suggestion";
import { historyStep } from "@/lib/chat/history";
import { markdownParagraphs } from "@/lib/chat/quote";
import { useCoarsePointer } from "./useCoarsePointer";
import { useMentions } from "./useMentions";
import { Attachments } from "./Attachments";
import { Toolbar } from "./Toolbar";
import { useImageDrop } from "./useImageDrop";
import type { MenuKey } from "./keys";
import { useComposerEditor, type ComposerHandlers } from "./useComposerEditor";

// Handled here rather than sent: picking it opens the model picker.
const MODEL_COMMAND: ChatCommand = {
  name: "model",
  description: "Switch the model for this conversation",
};

export interface ComposerProps {
  running: boolean;
  disabled?: boolean;
  placeholder: string;
  onSend: (text: string, images: ChatImage[]) => void;
  onStop: () => void;
  commands?: ChatCommand[];
  // Reloads the commands past the cache (a skill just added), from the menu.
  onRefreshCommands?: () => void;
  refreshingCommands?: boolean;
  models?: ChatModel[];
  model?: string;
  onSetModel?: (model: string) => void;
  access?: ChatAccess;
  onSetAccess?: (access: ChatAccess) => void;
  plan?: boolean | null;
  onTogglePlan?: () => void;
  accessory?: React.ReactNode;
  // Text to put back in the composer (an undone message), once per `at`.
  prefill?: { text: string; at: number };
  // Saves what's typed under this key, so a reload doesn't lose it.
  draftKey?: string;
  // The agent's guess at the next message, unless set aside.
  suggestion?: string | null;
  onDismissSuggestion?: (suggestion: string) => void;
  // Messages sent in this conversation, newest first, for ↑.
  history?: string[];
  // Files and folders for an @mention.
  requestFiles?: (query: string) => Promise<FileSuggestion[]>;
  // Markdown to put in at the caret (a quote), once per `at`.
  insert?: { text: string; at: number };
  // Takes the caret once it's ready, and again for each new draftKey.
  autoFocus?: boolean;
}

export function ComposerBody({
  running,
  disabled,
  placeholder,
  onSend,
  onStop,
  commands = [],
  onRefreshCommands,
  refreshingCommands = false,
  models = [],
  model = "",
  onSetModel,
  access,
  onSetAccess,
  plan,
  onTogglePlan,
  accessory,
  prefill,
  draftKey,
  suggestion = null,
  onDismissSuggestion,
  history = [],
  requestFiles,
  insert,
  autoFocus,
}: ComposerProps) {
  const [images, setImages] = useState<ChatImage[]>([]);
  const [files, setFiles] = useState<TextAttachment[]>([]);
  const lastPaste = useRef(0);
  // The highlighted command, for the text it was picked on: typing resets it.
  const [active, setActiveAt] = useState({ text: "", index: 0 });
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const handlers = useRef<ComposerHandlers | null>(null);
  const coarse = useCoarsePointer();
  const [historyIndex, setHistoryIndex] = useState(-1);
  // The editor shows it only while it's empty, as its placeholder.
  const { editor, text, setText, caret, plain, setPlain } = useComposerEditor({
    placeholder,
    ghost: coarse ? null : suggestion,
    disabled,
    handlers,
  });
  // On a keyboard the guess is ghost text; on a touch screen, a chip.
  const offered = offeredSuggestion({ suggestion, dismissed: null, text });
  const ghost = offered && !coarse ? offered : null;
  // Typing anything sets the guess aside.
  useEffect(() => {
    if (text && suggestion) onDismissSuggestion?.(suggestion);
  }, [text, suggestion, onDismissSuggestion]);

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
  useEffect(() => {
    if (autoFocus && editor) editor.commands.focus("end");
  }, [autoFocus, editor, draftKey]);

  const prefilled = useRef<number | null>(null);
  const inserted = useRef<number | null>(null);
  useEffect(() => {
    if (!prefill || !editor || prefilled.current === prefill.at) return;
    prefilled.current = prefill.at;
    setText(prefill.text, true);
  }, [prefill, editor, setText]);

  useEffect(() => {
    if (!insert || !editor || inserted.current === insert.at) return;
    inserted.current = insert.at;
    const content = markdownParagraphs(insert.text);
    if (!content.length) return;
    editor.chain().focus().insertContent(content).run();
  }, [insert, editor]);

  const query = slashQuery(text);
  const mentions = useMentions(editor, caret, query === null, requestFiles);
  const matches = useMemo(() => {
    if (query === null) return [];
    const all = [
      ...(onSetModel ? [MODEL_COMMAND] : []),
      ...commands.filter((c) => c.name !== "model"),
    ];
    return rankCommands(query, all);
  }, [query, commands, onSetModel]);
  // One menu at a time: "/" commands at the start, "@" files at the caret.
  const menuKey = query !== null ? `/${text}` : mentions.key;
  const menuOpen = menuKey !== null && dismissed !== menuKey;
  const options: MenuOption[] =
    query !== null
      ? matches.map((c, i) => ({
          key: `${c.name}-${i}`,
          label: `/${c.name}`,
          hint: c.argumentHint,
          description: c.description,
        }))
      : mentions.files.map((f) => ({
          key: `${f.dir ? "d" : "f"}:${f.path}`,
          // The name first, so two long paths never read the same.
          label: `${f.path.slice(f.path.lastIndexOf("/") + 1)}${f.dir ? "/" : ""}`,
          hint: f.path.includes("/")
            ? f.path.slice(0, f.path.lastIndexOf("/"))
            : undefined,
          icon: f.dir ? (
            <Folder className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
          ) : (
            <File className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
          ),
        }));
  const setActive = (index: number) =>
    setActiveAt({ text: menuKey ?? "", index });
  const highlighted = Math.min(
    active.text === menuKey ? active.index : 0,
    Math.max(options.length - 1, 0)
  );

  const pickCommand = (command: ChatCommand) => {
    if (command === MODEL_COMMAND) {
      setText("");
      setModelOpen(true);
      return;
    }
    setText(insertCommand(command.name), true);
  };
  const pick = (index: number) => {
    if (query !== null) {
      if (matches[index]) pickCommand(matches[index]);
    } else if (mentions.files[index]) mentions.pick(mentions.files[index]);
  };

  const acceptSuggestion = () => {
    if (offered) setText(offered, true);
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
    setHistoryIndex(-1);
  };

  const onMenuKey = (key: MenuKey) => {
    if (key === "close") setDismissed(menuKey);
    else if (key === "pick") pick(highlighted);
    else
      setActive(
        (highlighted + (key === "down" ? 1 : -1) + options.length) %
          options.length
      );
  };

  useEffect(() => {
    handlers.current = {
      menuOpen,
      menuHasMatches: options.length > 0,
      onMenuKey,
      onSend: submit,
      suggestion: ghost !== null,
      onAcceptSuggestion: acceptSuggestion,
      onHistory: (dir, at) => {
        if (images.length || files.length) return false;
        const step = historyStep(
          { history, index: historyIndex, text, ...at },
          dir
        );
        if (!step) return false;
        setHistoryIndex(step.index);
        setText(step.text, true);
        return true;
      },
      onImages: (picked) => void addFiles(picked),
      onLongPaste: (pasted, language) => {
        const next = nextAttachment(files, lastPaste.current);
        lastPaste.current = next.number;
        setFiles((prev) => [
          ...prev,
          { name: next.name, text: pasted, language },
        ]);
      },
    };
  });

  return (
    <div className="relative" data-composer-ghost={ghost ? "" : undefined}>
      {menuOpen && (query !== null || !mentions.loading || options.length) ? (
        <ComposerMenu
          label={query !== null ? "Commands" : "Files"}
          empty={query !== null ? "No matching commands" : "No matching files"}
          options={options}
          active={highlighted}
          onPick={pick}
          onHover={setActive}
          refresh={
            query !== null && onRefreshCommands
              ? { onClick: onRefreshCommands, busy: refreshingCommands }
              : undefined
          }
        />
      ) : null}
      {offered && coarse && !menuOpen && (
        <button
          type="button"
          onClick={acceptSuggestion}
          className="bg-card popover-surface text-muted-foreground hover:text-foreground mb-2 flex min-h-11 max-w-full items-center gap-2 rounded-full px-3.5 text-left text-sm"
        >
          <CornerDownRight className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 truncate">{offered}</span>
        </button>
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
          plan={plan}
          onTogglePlan={onTogglePlan}
          accessory={accessory}
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
