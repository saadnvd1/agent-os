'use client';

import { useCallback, useState } from 'react';
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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';

// ANSI escape sequences
const SPECIAL_KEYS = {
  UP: '\x1b[A',
  DOWN: '\x1b[B',
  LEFT: '\x1b[D',
  RIGHT: '\x1b[C',
  ESC: '\x1b',
  TAB: '\t',
  CTRL_C: '\x03',
  CTRL_D: '\x04',
  CTRL_Z: '\x1a',
  CTRL_L: '\x0c',
} as const;

interface TerminalToolbarProps {
  onKeyPress: (key: string) => void;
  onImagePicker?: () => void;
  visible?: boolean;
}

interface Snippet {
  id: string;
  name: string;
  content: string;
}

const SNIPPETS_STORAGE_KEY = 'terminal-snippets';

const DEFAULT_SNIPPETS: Snippet[] = [
  // Git shortcuts
  { id: 'default-1', name: 'Git status', content: 'git status' },
  { id: 'default-2', name: 'Git diff', content: 'git diff' },
  { id: 'default-3', name: 'Git add all', content: 'git add -A' },
  { id: 'default-4', name: 'Git commit', content: 'git commit -m ""' },
  { id: 'default-5', name: 'Git push', content: 'git push' },
  { id: 'default-6', name: 'Git pull', content: 'git pull' },
  // Claude Code prompts
  { id: 'default-7', name: 'Continue', content: 'continue' },
  { id: 'default-8', name: 'Yes', content: 'yes' },
  { id: 'default-9', name: 'No', content: 'no' },
  { id: 'default-10', name: 'Explain this', content: 'explain what this code does' },
  { id: 'default-11', name: 'Fix errors', content: 'fix the errors' },
  { id: 'default-12', name: 'Run tests', content: 'run the tests and fix any failures' },
  { id: 'default-13', name: 'Commit changes', content: 'commit these changes with a descriptive message' },
  // Common commands
  { id: 'default-14', name: 'List files', content: 'ls -la' },
  { id: 'default-15', name: 'NPM dev', content: 'npm run dev' },
  { id: 'default-16', name: 'NPM install', content: 'npm install' },
];

function getStoredSnippets(): Snippet[] {
  if (typeof window === 'undefined') return DEFAULT_SNIPPETS;
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
  const [snippets, setSnippets] = useState<Snippet[]>(() => getStoredSnippets());
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newContent, setNewContent] = useState('');

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
      setNewName('');
      setNewContent('');
      setIsAdding(false);
    }
  };

  const handleDelete = (id: string) => {
    const updated = snippets.filter(s => s.id !== id);
    setSnippets(updated);
    saveSnippets(updated);
  };

  const handleInsert = (content: string) => {
    onInsert(content);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-h-[70vh] bg-background rounded-t-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-medium">Snippets</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsAdding(!isAdding)}
              className="p-1.5 rounded-md hover:bg-muted"
            >
              <Plus className="h-5 w-5" />
            </button>
            <button onClick={onClose} className="p-1.5 rounded-md hover:bg-muted">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Add new snippet form */}
        {isAdding && (
          <div className="px-4 py-3 border-b border-border bg-muted/50">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Snippet name..."
              className="w-full px-3 py-2 mb-2 rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <textarea
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="Command or text..."
              className="w-full h-20 px-3 py-2 rounded-lg bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary font-mono"
            />
            <button
              onClick={handleAdd}
              disabled={!newName.trim() || !newContent.trim()}
              className="mt-2 w-full py-2 rounded-lg bg-primary text-primary-foreground font-medium disabled:opacity-50"
            >
              Save Snippet
            </button>
          </div>
        )}

        {/* Snippets list */}
        <div className="flex-1 overflow-y-auto">
          {snippets.length === 0 ? (
            <div className="px-4 py-8 text-center text-muted-foreground text-sm">
              No snippets yet. Tap + to add one.
            </div>
          ) : (
            snippets.map((snippet) => (
              <div
                key={snippet.id}
                className="flex items-center gap-2 px-4 py-3 border-b border-border active:bg-muted"
              >
                <button
                  onClick={() => handleInsert(snippet.content)}
                  className="flex-1 text-left min-w-0"
                >
                  <div className="text-sm font-medium truncate">{snippet.name}</div>
                  <div className="text-xs text-muted-foreground truncate font-mono">
                    {snippet.content}
                  </div>
                </button>
                <button
                  onClick={() => handleDelete(snippet.id)}
                  className="p-2 rounded-md hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
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
  onPaste
}: {
  open: boolean;
  onClose: () => void;
  onPaste: (text: string) => void;
}) {
  const [text, setText] = useState('');

  const handleSend = () => {
    if (text) {
      onPaste(text);
      setText('');
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-[90%] max-w-md bg-background rounded-xl p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium">Paste text</span>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const pasted = e.clipboardData?.getData('text');
            if (pasted) {
              e.preventDefault();
              setText(prev => prev + pasted);
            }
          }}
          placeholder="Tap here, then long-press to paste..."
          autoFocus
          className="w-full h-24 px-3 py-2 rounded-lg bg-muted text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <button
          onClick={handleSend}
          disabled={!text}
          className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary text-primary-foreground font-medium disabled:opacity-50"
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
  visible = true,
}: TerminalToolbarProps) {
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [showSnippetsModal, setShowSnippetsModal] = useState(false);
  const [shiftActive, setShiftActive] = useState(false);

  // Speech recognition - send transcript directly to terminal
  const handleTranscript = useCallback((text: string) => {
    for (const char of text) {
      onKeyPress(char);
    }
  }, [onKeyPress]);

  const { isListening, isSupported: isMicSupported, toggle: toggleMic } = useSpeechRecognition(handleTranscript);

  // Handle paste - try clipboard API first, fall back to modal
  const handlePaste = useCallback(async () => {
    try {
      if (navigator.clipboard?.readText) {
        const text = await navigator.clipboard.readText();
        if (text) {
          for (const char of text) {
            onKeyPress(char);
          }
          return;
        }
      }
    } catch {
      // Clipboard API failed
    }
    setShowPasteModal(true);
  }, [onKeyPress]);

  // Handle paste from modal
  const handleModalPaste = useCallback((text: string) => {
    for (const char of text) {
      onKeyPress(char);
    }
  }, [onKeyPress]);

  // Handle snippet insertion
  const handleSnippetInsert = useCallback((content: string) => {
    for (const char of content) {
      onKeyPress(char);
    }
  }, [onKeyPress]);

  if (!visible) return null;

  const buttons = [
    { label: 'Esc', key: SPECIAL_KEYS.ESC },
    { label: '^C', key: SPECIAL_KEYS.CTRL_C, highlight: true },
    { label: 'Tab', key: SPECIAL_KEYS.TAB },
    { label: '^D', key: SPECIAL_KEYS.CTRL_D },
    { label: '←', key: SPECIAL_KEYS.LEFT },
    { label: '→', key: SPECIAL_KEYS.RIGHT },
    { label: '↑', key: SPECIAL_KEYS.UP },
    { label: '↓', key: SPECIAL_KEYS.DOWN },
  ];

  return (
    <>
      <PasteModal
        open={showPasteModal}
        onClose={() => setShowPasteModal(false)}
        onPaste={handleModalPaste}
      />
      <SnippetsModal
        open={showSnippetsModal}
        onClose={() => setShowSnippetsModal(false)}
        onInsert={handleSnippetInsert}
      />
      <div
        className="flex items-center gap-1 px-2 py-1.5 bg-background/95 backdrop-blur border-t border-border overflow-x-auto scrollbar-none"
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
              "flex-shrink-0 px-2.5 py-1.5 rounded-md text-xs font-medium",
              isListening
                ? "bg-red-500 text-white animate-pulse"
                : "bg-secondary text-secondary-foreground active:bg-primary active:text-primary-foreground"
            )}
          >
            {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
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
          className="flex-shrink-0 px-2.5 py-1.5 rounded-md text-xs font-medium bg-secondary text-secondary-foreground active:bg-primary active:text-primary-foreground"
        >
          <Clipboard className="h-4 w-4" />
        </button>

        {/* Image picker button */}
        {onImagePicker && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              onImagePicker();
            }}
            className="flex-shrink-0 px-2.5 py-1.5 rounded-md text-xs font-medium bg-secondary text-secondary-foreground active:bg-primary active:text-primary-foreground"
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
          className="flex-shrink-0 px-2.5 py-1.5 rounded-md text-xs font-medium bg-secondary text-secondary-foreground active:bg-primary active:text-primary-foreground"
        >
          <FileText className="h-4 w-4" />
        </button>

        {/* Divider */}
        <div className="w-px h-6 bg-border mx-1" />

        {/* Shift toggle */}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            setShiftActive(!shiftActive);
          }}
          className={cn(
            "flex-shrink-0 px-2.5 py-1.5 rounded-md text-xs font-medium",
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
            onKeyPress(shiftActive ? '\n' : '\r');
            setShiftActive(false);
          }}
          className="flex-shrink-0 px-2.5 py-1.5 rounded-md text-xs font-medium bg-secondary text-secondary-foreground active:bg-primary active:text-primary-foreground"
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
              "flex-shrink-0 px-2.5 py-1.5 rounded-md text-xs font-medium",
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
