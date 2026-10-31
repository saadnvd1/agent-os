"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  clientConfigQuery,
  useClientConfig,
} from "@/data/client-config/queries";
import {
  acceptAttr,
  tooBigMessage,
  typeFor,
  unsupportedMessage,
} from "@/lib/attachments/policy";
import type { ChatFile, ChatImage } from "@/lib/chat/events";
import { uploadFile } from "@/lib/file-upload";
import { isImage } from "./paste";
import { shrinkImage } from "./shrinkImage";

export interface Upload {
  key: string;
  file: ChatFile;
  uploading?: boolean;
}

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

let seq = 0;

// Files picked, pasted or dropped onto the composer, and the outline shown
// while something is dragged over it. Images are read in and sent with the
// message; any other file is uploaded to the session's attachments folder
// at once, so a wrong type or a too-big file fails here, not at send. The
// types and sizes come from the server (/api/client-config).
export function useAttachFiles({
  scope,
  imageCount,
  onImages,
}: {
  // The session's id, or "draft" for a chat that hasn't started.
  scope: string;
  imageCount: number;
  onImages: (images: ChatImage[]) => void;
}) {
  const queryClient = useQueryClient();
  const types = useClientConfig().data?.attachments.types;
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const held = useRef(0);
  held.current = imageCount + uploads.length;

  const addFiles = async (picked: Iterable<File>) => {
    // Copied first: a file input's live list is emptied right after the pick.
    const list = [...picked];
    let limits;
    try {
      limits = (await queryClient.fetchQuery(clientConfigQuery)).attachments;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't attach");
      return;
    }
    const images: File[] = [];
    const others: File[] = [];
    for (const f of list) {
      let error: string | null = null;
      if (held.current + images.length + others.length >= limits.max)
        error = `You can attach up to ${limits.max} files to one message.`;
      else if (isImage(f)) {
        const shrunk = await shrinkImage(f, limits.maxImageBytes);
        if (shrunk.ok) images.push(shrunk.file);
        else error = tooBigMessage(f.name, f.size, limits.maxImageBytes);
      } else if (!typeFor(f.name, limits.types))
        error = unsupportedMessage(f.name);
      else if (f.size > limits.maxBytes)
        error = tooBigMessage(f.name, f.size, limits.maxBytes);
      else others.push(f);
      if (error) toast.error(error);
    }
    if (images.length) onImages(await Promise.all(images.map(readImage)));
    for (const f of others) {
      const key = `up-${++seq}`;
      const file = { path: "", name: f.name, size: f.size, mediaType: f.type };
      setUploads((prev) => [...prev, { key, file, uploading: true }]);
      const done = await uploadFile(f, scope);
      if (done.ok)
        setUploads((prev) =>
          prev.map((u) => (u.key === key ? { key, file: done.file } : u))
        );
      else {
        setUploads((prev) => prev.filter((u) => u.key !== key));
        toast.error(done.error);
      }
    }
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

  return {
    dragging,
    dropProps,
    addFiles,
    uploads,
    // Until the limits are read, the picker offers images only.
    accept: types ? `image/*,${acceptAttr(types)}` : "image/*",
    uploading: uploads.some((u) => u.uploading),
    remove: (key: string) =>
      setUploads((prev) => prev.filter((u) => u.key !== key)),
    clear: () => setUploads([]),
    restore: (files: ChatFile[]) =>
      setUploads(files.map((file) => ({ key: `up-${++seq}`, file }))),
  };
}
