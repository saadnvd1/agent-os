"use client";

import { useCallback, useState } from "react";
import {
  Clipboard,
  X,
  Send,
  Mic,
  MicOff,
  ImagePlus,
  FileText,
  Plus,
  Trash2,
  MousePointer2,
  Copy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";

// ANSI escape sequences
const SPECIAL_KEYS = {
  UP: "\x1b[A",
  DOWN: "\x1b[B",
  LEFT: "\x1b[D",
  RIGHT: "\x1b[C",
  ESC: "\x1b",
  TAB: "\t",
  CTRL_C: "\x03",
  CTRL_D: "\x04",
  CTRL_Z: "\x1a",
  CTRL_L: "\x0c",
} as const;

interface TerminalToolbarProps {
  onKeyPress: (key: string) => void;
  onImagePicker?: () => void;
  onCopy?: () => boolean; // Returns true if selection was copied
  selectMode?: boolean;
  onSelectModeChange?: (enabled: boolean) => void;
  visible?: boolean;
}

interface Snippet {
  id: string;
  name: string;
  content: string;
}

const SNIPPETS_STORAGE_KEY = "terminal-snippets";

const DEFAULT_SNIPPETS: Snippet[] = [
  // Git shortcuts
  { id: "default-1", name: "Git status", content: "git status" },
  { id: "default-2", name: "Git diff", content: "git diff" },
  { id: "default-3", name: "Git add all", content: "git add -A" },
  { id: "default-4", name: "Git commit", content: 'git commit -m ""' },
  { id: "default-5", name: "Git push", content: "git push" },
  { id: "default-6", name: "Git pull", content: "git pull" },
  // Claude Code prompts
  { id: "default-7", name: "Continue", content: "continue" },
  { id: "default-8", name: "Yes", content: "yes" },
  { id: "default-9", name: "No", content: "no" },
  {
    id: "default-10",
    name: "Explain this",
    content: "explain what this code does",
  },
  { id: "default-11", name: "Fix errors", content: "fix the errors" },
  {
    id: "default-12",
    name: "Run tests",
    content: "run the tests and fix any failures",
  },
  {
    id: "default-13",
    name: "Commit changes",
    content: "commit these changes with a descriptive message",
  },
  // Common commands
  { id: "default-14", name: "List files", content: "ls -la" },
  { id: "default-15", name: "NPM dev", content: "npm run dev" },
  { id: "default-16", name: "NPM install", content: "npm install" },
];

function getStoredSnippets(): Snippet[] {
  if (typeof window === "undefined") return DEFAULT_SNIPPETS;
  try {
    const stored = localStorage.getItem(SNIPPETS_STORAGE_KEY);
    if (!stored) {
      // First time - save defaults
      saveSnippets(DEFAULT_SNIPPETS);
      return DEFAULT_SNIPPETS;
    }
    return JSON.parse(stored);
  } catch {
    return DEFAULT_SNIPPETS;
  }
}

function saveSnippets(snippets: Snippet[]) {
  localStorage.setItem(SNIPPETS_STORAGE_KEY, JSON.stringify(snippets));
}

// Snippets modal for saving/inserting common commands
function SnippetsModal({
  open,
  onClose,
  onInsert,
}: {
  open: boolean;
  onClose: () => void;
  onInsert: (content: string) => void;
}) {
  const [snippets, setSnippets] = useState<Snippet[]>(() =>
    getStoredSnippets()
  );
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newContent, setNewContent] = useState("");

  const handleAdd = () => {
    if (newName.trim() && newContent.trim()) {
      const newSnippet: Snippet = {
        id: Date.now().toString(),
        name: newName.trim(),
        content: newContent.trim(),
      };
      const updated = [...snippets, newSnippet];
      setSnippets(updated);
      saveSnippets(updated);
      setNewName("");
      setNewContent("");
      setIsAdding(false);
    }
  };

  const handleDelete = (id: string) => {
    const updated = snippets.filter((s) => s.id !== id);
    setSnippets(updated);
    saveSnippets(updated);
  };

  const handleInsert = (content: string) => {
    onInsert(content);
    onClose();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-background flex max-h-[70vh] w-full flex-col rounded-t-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-border flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-medium">Snippets</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsAdding(!isAdding)}
              className="hover:bg-muted rounded-md p-1.5"
            >
              <Plus className="h-5 w-5" />
            </button>
            <button
              onClick={onClose}
              className="hover:bg-muted rounded-md p-1.5"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Add new snippet form */}
        {isAdding && (
          <div className="border-border bg-muted/50 border-b px-4 py-3">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Snippet name..."
              className="bg-background focus:ring-primary mb-2 w-full rounded-lg px-3 py-2 text-sm focus:ring-2 focus:outline-none"
            />
            <textarea
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="Command or text..."
              className="bg-background focus:ring-primary h-20 w-full resize-none rounded-lg px-3 py-2 font-mono text-sm focus:ring-2 focus:outline-none"
            />
            <button
              onClick={handleAdd}
              disabled={!newName.trim() || !newContent.trim()}
              className="bg-primary text-primary-foreground mt-2 w-full rounded-lg py-2 font-medium disabled:opacity-50"
            >
              Save Snippet
            </button>
          </div>
        )}

        {/* Snippets list */}
        <div className="flex-1 overflow-y-auto">
          {snippets.length === 0 ? (
            <div className="text-muted-foreground px-4 py-8 text-center text-sm">
              No snippets yet. Tap + to add one.
            </div>
          ) : (
            snippets.map((snippet) => (
              <div
                key={snippet.id}
                className="border-border active:bg-muted flex items-center gap-2 border-b px-4 py-3"
              >
                <button
                  onClick={() => handleInsert(snippet.content)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="truncate text-sm font-medium">
                    {snippet.name}
                  </div>
                  <div className="text-muted-foreground truncate font-mono text-xs">
                    {snippet.content}
                  </div>
                </button>
                <button
                  onClick={() => handleDelete(snippet.id)}
                  className="hover:bg-destructive/20 text-muted-foreground hover:text-destructive rounded-md p-2"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// Paste modal for when clipboard API isn't available
function PasteModal({
  open,
  onClose,
  onPaste,
}: {
  open: boolean;
  onClose: () => void;
  onPaste: (text: string) => void;
}) {
  const [text, setText] = useState("");

  const handleSend = () => {
    if (text) {
      onPaste(text);
      setText("");
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-background w-[90%] max-w-md rounded-xl p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-medium">Paste text</span>
          <button onClick={onClose} className="hover:bg-muted rounded-md p-1">
            <X className="h-5 w-5" />
          </button>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const pasted = e.clipboardData?.getData("text");
            if (pasted) {
              e.preventDefault();
              setText((prev) => prev + pasted);
            }
          }}
          placeholder="Tap here, then long-press to paste..."
          autoFocus
          className="bg-muted focus:ring-primary h-24 w-full resize-none rounded-lg px-3 py-2 text-sm focus:ring-2 focus:outline-none"
        />
        <button
          onClick={handleSend}
          disabled={!text}
          className="bg-primary text-primary-foreground mt-3 flex w-full items-center justify-center gap-2 rounded-lg py-2.5 font-medium disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
          Send to Terminal
        </button>
      </div>
    </div>
  );
}

export function TerminalToolbar({
  onKeyPress,
  onImagePicker,
  onCopy,
  selectMode = false,
  onSelectModeChange,
  visible = true,
}: TerminalToolbarProps) {
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [showSnippetsModal, setShowSnippetsModal] = useState(false);
  const [shiftActive, setShiftActive] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);

  // Send text character-by-character to terminal
  const sendText = useCallback(
    (text: string) => {
      for (const char of text) {
        onKeyPress(char);
      }
    },
    [onKeyPress]
  );

  const {
    isListening,
    isSupported: isMicSupported,
    toggle: toggleMic,
  } = useSpeechRecognition(sendText);

  // Handle paste - try clipboard API first, fall back to modal
  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard?.readText?.();
      if (text) {
        sendText(text);
        return;
      }
    } catch {
      // Clipboard API failed or unavailable
    }
    setShowPasteModal(true);
  }, [sendText]);

  // Handle copy with visual feedback
  const handleCopy = useCallback(() => {
    if (onCopy?.()) {
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 1000);
    }
  }, [onCopy]);

  if (!visible) return null;

  const buttons = [
    { label: "Esc", key: SPECIAL_KEYS.ESC },
    { label: "^C", key: SPECIAL_KEYS.CTRL_C, highlight: true },
    { label: "Tab", key: SPECIAL_KEYS.TAB },
    { label: "^D", key: SPECIAL_KEYS.CTRL_D },
    { label: "←", key: SPECIAL_KEYS.LEFT },
    { label: "→", key: SPECIAL_KEYS.RIGHT },
    { label: "↑", key: SPECIAL_KEYS.UP },
    { label: "↓", key: SPECIAL_KEYS.DOWN },
  ];

  return (
    <>
      <PasteModal
        open={showPasteModal}
        onClose={() => setShowPasteModal(false)}
        onPaste={sendText}
      />
      <SnippetsModal
        open={showSnippetsModal}
        onClose={() => setShowSnippetsModal(false)}
        onInsert={sendText}
      />
      <div
        className="bg-background/95 border-border scrollbar-none flex items-center gap-1 overflow-x-auto border-t px-2 py-1.5 backdrop-blur"
        onTouchEnd={(e) => e.stopPropagation()}
      >
        {/* Mic button */}
        {isMicSupported && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              toggleMic();
            }}
            className={cn(
              "flex-shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium",
              isListening
                ? "animate-pulse bg-red-500 text-white"
                : "bg-secondary text-secondary-foreground active:bg-primary active:text-primary-foreground"
            )}
          >
            {isListening ? (
              <MicOff className="h-4 w-4" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
          </button>
        )}

        {/* Paste button */}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            handlePaste();
          }}
          className="bg-secondary text-secondary-foreground active:bg-primary active:text-primary-foreground flex-shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium"
        >
          <Clipboard className="h-4 w-4" />
        </button>

        {/* Select mode toggle */}
        {onSelectModeChange && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              onSelectModeChange(!selectMode);
            }}
            className={cn(
              "flex-shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium",
              selectMode
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground active:bg-primary active:text-primary-foreground"
            )}
          >
            <MousePointer2 className="h-4 w-4" />
          </button>
        )}

        {/* Copy button - shown when in select mode */}
        {selectMode && onCopy && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              handleCopy();
            }}
            className={cn(
              "flex-shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium",
              copyFeedback
                ? "bg-green-500 text-white"
                : "bg-secondary text-secondary-foreground active:bg-primary active:text-primary-foreground"
            )}
          >
            <Copy className="h-4 w-4" />
          </button>
        )}

        {/* Image picker button */}
        {onImagePicker && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              onImagePicker();
            }}
            className="bg-secondary text-secondary-foreground active:bg-primary active:text-primary-foreground flex-shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium"
          >
            <ImagePlus className="h-4 w-4" />
          </button>
        )}

        {/* Snippets button */}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            setShowSnippetsModal(true);
          }}
          className="bg-secondary text-secondary-foreground active:bg-primary active:text-primary-foreground flex-shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium"
        >
          <FileText className="h-4 w-4" />
        </button>

        {/* Divider */}
        <div className="bg-border mx-1 h-6 w-px" />

        {/* Shift toggle */}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            setShiftActive(!shiftActive);
          }}
          className={cn(
            "flex-shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium",
            shiftActive
              ? "bg-primary text-primary-foreground"
              : "bg-secondary text-secondary-foreground active:bg-primary active:text-primary-foreground"
          )}
        >
          ⇧
        </button>

        {/* Enter key - sends \n if shift active, \r otherwise */}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            onKeyPress(shiftActive ? "\n" : "\r");
            setShiftActive(false);
          }}
          className="bg-secondary text-secondary-foreground active:bg-primary active:text-primary-foreground flex-shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium"
        >
          ↵
        </button>

        {/* Special keys */}
        {buttons.map((btn) => (
          <button
            type="button"
            key={btn.label}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              onKeyPress(btn.key);
            }}
            className={cn(
              "flex-shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium",
              "active:bg-primary active:text-primary-foreground",
              btn.highlight
                ? "bg-red-500/20 text-red-500"
                : "bg-secondary text-secondary-foreground"
            )}
          >
            {btn.label}
          </button>
        ))}
      </div>
    </>
  );
}
