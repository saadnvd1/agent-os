import { useQuery } from "@tanstack/react-query";
import { fileKeys } from "./keys";
import type { FileNode } from "@/lib/file-utils";

export { fileKeys };

export interface DirectoryData {
  files: FileNode[];
  resolvedPath: string;
}

async function fetchDirectory(path: string): Promise<DirectoryData> {
  const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return { files: data.files || [], resolvedPath: data.path || path };
}

export function useDirectoryFilesQuery(path: string) {
  return useQuery({
    queryKey: fileKeys.list(path),
    queryFn: () => fetchDirectory(path),
    staleTime: 10000,
  });
}
