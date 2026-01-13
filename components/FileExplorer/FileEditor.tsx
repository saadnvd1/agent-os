"use client";

import { useEffect, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView, keymap } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { json } from "@codemirror/lang-json";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { markdown } from "@codemirror/lang-markdown";
import type { Extension } from "@codemirror/state";
import { FileCode } from "lucide-react";

interface FileEditorProps {
  content: string;
  language: string;
  isBinary: boolean;
  readOnly?: boolean;
  onChange: (content: string) => void;
  onSave?: () => void;
}

// Theme that uses CSS variables from the app
const editorTheme = EditorView.theme({
  "&": {
    fontSize: "13px",
    height: "100%",
    backgroundColor: "hsl(var(--background))",
    color: "hsl(var(--foreground))",
  },
  ".cm-content": {
    fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
    padding: "8px 0",
    caretColor: "hsl(var(--primary))",
  },
  ".cm-gutters": {
    backgroundColor: "hsl(var(--background))",
    borderRight: "none",
    color: "hsl(var(--muted-foreground))",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 8px 0 16px",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "hsl(var(--accent))",
  },
  ".cm-activeLine": {
    backgroundColor: "hsl(var(--accent) / 0.5)",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "hsl(var(--primary) / 0.3) !important",
  },
  "&.cm-focused .cm-cursor": {
    borderLeftColor: "hsl(var(--primary))",
    borderLeftWidth: "2px",
  },
  ".cm-scroller": {
    overflow: "auto",
  },
  ".cm-foldGutter": {
    color: "hsl(var(--muted-foreground))",
  },
  ".cm-tooltip": {
    backgroundColor: "hsl(var(--popover))",
    boxShadow: "0 4px 12px hsl(var(--foreground) / 0.15)",
    color: "hsl(var(--popover-foreground))",
  },
  ".cm-tooltip-autocomplete": {
    "& > ul > li[aria-selected]": {
      backgroundColor: "hsl(var(--accent))",
      color: "hsl(var(--accent-foreground))",
    },
  },
  ".cm-panels": {
    backgroundColor: "hsl(var(--muted))",
  },
  ".cm-searchMatch": {
    backgroundColor: "hsl(var(--primary) / 0.2)",
    outline: "1px solid hsl(var(--primary) / 0.4)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "hsl(var(--primary) / 0.4)",
  },
});

// Syntax highlighting that adapts to both light and dark themes
const highlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: "hsl(var(--primary))" },
  { tag: [t.name, t.deleted, t.character, t.macroName], color: "hsl(var(--foreground))" },
  { tag: [t.propertyName], color: "#7dd3fc" }, // sky-300
  { tag: [t.function(t.variableName), t.labelName], color: "#c4b5fd" }, // violet-300
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: "#fcd34d" }, // amber-300
  { tag: [t.definition(t.name), t.separator], color: "hsl(var(--foreground))" },
  { tag: [t.typeName, t.className, t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace], color: "#f9a8d4" }, // pink-300
  { tag: [t.operator, t.operatorKeyword, t.url, t.escape, t.regexp, t.special(t.string)], color: "#67e8f9" }, // cyan-300
  { tag: [t.meta, t.comment], color: "hsl(var(--muted-foreground))", fontStyle: "italic" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, color: "#67e8f9", textDecoration: "underline" },
  { tag: t.heading, fontWeight: "bold", color: "hsl(var(--primary))" },
  { tag: [t.atom, t.bool], color: "#f9a8d4" }, // pink-300
  { tag: [t.processingInstruction, t.string, t.inserted], color: "#86efac" }, // green-300
  { tag: t.invalid, color: "#fca5a5" }, // red-300
]);

function getLanguageExtension(language: string): Extension | null {
  switch (language) {
    case "javascript":
      return javascript({ jsx: true });
    case "typescript":
      return javascript({ jsx: true, typescript: true });
    case "python":
      return python();
    case "json":
      return json();
    case "css":
    case "scss":
      return css();
    case "html":
    case "xml":
      return html();
    case "markdown":
      return markdown();
    default:
      return null;
  }
}

export function FileEditor({
  content,
  language,
  isBinary,
  readOnly = false,
  onChange,
  onSave,
}: FileEditorProps) {
  const [extensions, setExtensions] = useState<Extension[]>([]);

  useEffect(() => {
    const langExt = getLanguageExtension(language);
    const baseExtensions: Extension[] = [
      editorTheme,
      syntaxHighlighting(highlightStyle),
      EditorView.lineWrapping,
    ];

    if (onSave) {
      baseExtensions.push(
        keymap.of([
          {
            key: "Mod-s",
            run: () => {
              onSave();
              return true;
            },
          },
        ])
      );
    }

    if (langExt) {
      baseExtensions.push(langExt);
    }

    setExtensions(baseExtensions);
  }, [language, onSave]);

  if (isBinary) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-8">
        <FileCode className="w-12 h-12 mb-4 opacity-50" />
        <p className="text-sm text-center">Binary file cannot be displayed</p>
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-hidden bg-background">
      <CodeMirror
        value={content}
        height="100%"
        theme="none"
        extensions={extensions}
        onChange={onChange}
        readOnly={readOnly}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLineGutter: true,
          highlightActiveLine: true,
          foldGutter: true,
          dropCursor: true,
          allowMultipleSelections: true,
          indentOnInput: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: true,
          rectangularSelection: true,
          crosshairCursor: false,
          highlightSelectionMatches: true,
          searchKeymap: true,
        }}
        className="h-full [&_.cm-editor]:h-full [&_.cm-scroller]:!overflow-auto"
      />
    </div>
  );
}
