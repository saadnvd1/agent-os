"use client";

import { FileText, X } from "lucide-react";
import type { ChatImage } from "@/lib/chat/events";
import { byteLength, type TextAttachment } from "@/lib/chat/paste";

const size = (text: string) => {
  const kb = byteLength(text) / 1024;
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`;
};

const lines = (text: string) => text.replace(/\n+$/, "").split("\n").length;

function Remove({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="bg-background absolute -top-1.5 -right-1.5 rounded-full p-0.5 shadow"
    >
      <X className="h-3 w-3" />
    </button>
  );
}

// Images and long pastes waiting to go with the message.
export function Attachments({
  images,
  files,
  onRemoveImage,
  onRemoveFile,
}: {
  images: ChatImage[];
  files: TextAttachment[];
  onRemoveImage: (index: number) => void;
  onRemoveFile: (index: number) => void;
}) {
  if (!images.length && !files.length) return null;
  return (
    <div className="flex flex-wrap gap-2 px-1 pb-2">
      {images.map((img, i) => (
        <div key={`img-${i}`} className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`data:${img.mediaType};base64,${img.data}`}
            alt=""
            className="h-14 w-14 rounded-lg object-cover"
          />
          <Remove label="Remove image" onClick={() => onRemoveImage(i)} />
        </div>
      ))}
      {files.map((file, i) => (
        <div
          key={`file-${i}`}
          className="bg-foreground/[0.05] relative flex h-14 max-w-56 items-center gap-2 rounded-lg px-3"
          title={file.name}
        >
          <FileText className="text-muted-foreground h-4 w-4 shrink-0" />
          <span className="min-w-0">
            <span className="block truncate text-sm">{file.name}</span>
            <span className="text-muted-foreground block text-xs">
              {size(file.text)} · {lines(file.text).toLocaleString()} lines
            </span>
          </span>
          <Remove
            label={`Remove ${file.name}`}
            onClick={() => onRemoveFile(i)}
          />
        </div>
      ))}
    </div>
  );
}
