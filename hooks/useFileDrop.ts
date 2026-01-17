"use client";

import { useState, useCallback, useEffect, type RefObject } from "react";

interface UseFileDropOptions {
  /** Disable drop handling (e.g., while uploading) */
  disabled?: boolean;
}

interface DragHandlers {
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

/**
 * Hook for handling file drag and drop on a container element.
 *
 * @param containerRef - Ref to the container element for relatedTarget checking
 * @param onFileDrop - Callback when a file is dropped
 * @param options - Optional configuration
 * @returns isDragging state and drag event handlers to spread onto the container
 */
export function useFileDrop(
  containerRef: RefObject<HTMLElement | null>,
  onFileDrop: (file: File) => void,
  options?: UseFileDropOptions
): { isDragging: boolean; dragHandlers: DragHandlers } {
  const [isDragging, setIsDragging] = useState(false);

  // Reset drag state when disabled
  useEffect(() => {
    if (options?.disabled) {
      setIsDragging(false);
    }
  }, [options?.disabled]);

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!options?.disabled) {
        setIsDragging(true);
      }
    },
    [options?.disabled]
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // Only set to false if leaving the container entirely
      // This prevents flickering when moving over nested elements
      if (!containerRef.current?.contains(e.relatedTarget as Node)) {
        setIsDragging(false);
      }
    },
    [containerRef]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      // Don't process drops if disabled
      if (options?.disabled) return;

      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        onFileDrop(files[0]);
      }
    },
    [onFileDrop, options?.disabled]
  );

  return {
    isDragging,
    dragHandlers: {
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
    },
  };
}
