"use client";

import { useState, useEffect, useCallback } from "react";

let cachedHomePath: string | null = null;

export function useHomePath() {
  const [homePath, setHomePath] = useState<string | null>(cachedHomePath);

  useEffect(() => {
    if (cachedHomePath) return;
    fetch("/api/files?path=~")
      .then((res) => res.json())
      .then((data) => {
        if (data.path) {
          cachedHomePath = data.path;
          setHomePath(data.path);
        }
      })
      .catch(() => {});
  }, []);

  const toTildePath = useCallback(
    (absolutePath: string) => {
      if (homePath && absolutePath.startsWith(homePath)) {
        return "~" + absolutePath.slice(homePath.length);
      }
      return absolutePath;
    },
    [homePath]
  );

  return { homePath, toTildePath };
}
