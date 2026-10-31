"use client";

import type { Ref } from "react";
import { Search, X } from "lucide-react";

export function SearchField({
  value,
  onChange,
  placeholder,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  inputRef: Ref<HTMLInputElement>;
}) {
  return (
    <label className="bg-input/60 hairline mx-1.5 mt-1.5 flex h-11 items-center gap-2 rounded-lg px-3 md:h-9">
      <Search className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        aria-label={placeholder}
        className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-base outline-none md:text-sm"
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
          className="text-muted-foreground hover:text-foreground grid h-11 w-8 place-items-center md:h-8"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : (
        <kbd className="text-muted-foreground bg-muted hidden rounded px-1.5 text-[10px] md:block">
          /
        </kbd>
      )}
    </label>
  );
}
