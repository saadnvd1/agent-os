"use client";

import { useState } from "react";
import type { ChatImage } from "@/lib/chat/events";
import { isImage } from "./paste";

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

const carriesFiles = (e: React.DragEvent) =>
  [...e.dataTransfer.types].includes("Files");

// Images picked, pasted or dropped onto the composer, and the outline
// shown while something is dragged over it.
export function useImageDrop(onImages: (images: ChatImage[]) => void) {
  const [dragging, setDragging] = useState(false);

  const addFiles = async (picked: Iterable<File>) => {
    const read = await Promise.all([...picked].filter(isImage).map(readImage));
    if (read.length) onImages(read);
  };

  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setDragging(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null))
        setDragging(false);
    },
    onDrop: (e: React.DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      setDragging(false);
      void addFiles(e.dataTransfer.files);
    },
  };

  return { dragging, dropProps, addFiles };
}
