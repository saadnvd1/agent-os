/**
 * File system utilities for file explorer
 */

import { readdirSync, statSync, readFileSync } from "fs";
import { join, relative, basename, extname } from "path";

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  extension?: string;
  children?: FileNode[];
}

/**
 * Default exclude patterns (matches common ignore patterns)
 */
const DEFAULT_EXCLUDES = [
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "out",
  "coverage",
  ".cache",
  ".vercel",
  ".turbo",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".venv",
  "venv",
  ".DS_Store",
  "*.log",
  ".env",
  ".env.local",
  ".env.*.local",
  "*.db",
  "*.db-wal",
  "*.db-shm",
];

/**
 * Check if a file/directory should be excluded
 */
function shouldExclude(name: string, excludePatterns: string[]): boolean {
  return excludePatterns.some(pattern => {
    if (pattern.includes("*")) {
      // Simple glob pattern matching
      const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
      return regex.test(name);
    }
    return name === pattern;
  });
}

/**
 * List directory contents with exclusions
 */
export function listDirectory(
  dirPath: string,
  options: {
    excludePatterns?: string[];
    recursive?: boolean;
    maxDepth?: number;
    currentDepth?: number;
  } = {}
): FileNode[] {
  const {
    excludePatterns = DEFAULT_EXCLUDES,
    recursive = false,
    maxDepth = 3,
    currentDepth = 0,
  } = options;

  try {
    const entries = readdirSync(dirPath);
    const nodes: FileNode[] = [];

    for (const entry of entries) {
      // Skip excluded files
      if (shouldExclude(entry, excludePatterns)) {
        continue;
      }

      const fullPath = join(dirPath, entry);
      let stat;

      try {
        stat = statSync(fullPath);
      } catch {
        // Permission denied or other error, skip
        continue;
      }

      const isDir = stat.isDirectory();
      const node: FileNode = {
        name: entry,
        path: fullPath,
        type: isDir ? "directory" : "file",
      };

      if (!isDir) {
        node.size = stat.size;
        node.extension = extname(entry).slice(1); // Remove leading dot
      }

      // Recursively load children if requested and not at max depth
      if (isDir && recursive && currentDepth < maxDepth) {
        node.children = listDirectory(fullPath, {
          excludePatterns,
          recursive: true,
          maxDepth,
          currentDepth: currentDepth + 1,
        });
      }

      nodes.push(node);
    }

    // Sort: directories first, then files, alphabetically within each group
    return nodes.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  } catch (error) {
    console.error(`Failed to list directory ${dirPath}:`, error);
    return [];
  }
}

/**
 * Read file contents with encoding detection
 */
export function readFileContent(
  filePath: string,
  options: { maxSize?: number } = {}
): { content: string; isBinary: boolean; size: number } {
  const { maxSize = 1024 * 1024 } = options; // Default 1MB max

  try {
    const stat = statSync(filePath);

    if (stat.size > maxSize) {
      return {
        content: `File too large (${(stat.size / 1024 / 1024).toFixed(2)}MB). Maximum size: ${(maxSize / 1024 / 1024).toFixed(2)}MB`,
        isBinary: false,
        size: stat.size,
      };
    }

    const buffer = readFileSync(filePath);

    // Simple binary detection: check for null bytes
    const isBinary = buffer.includes(0);

    if (isBinary) {
      return {
        content: `Binary file (${(stat.size / 1024).toFixed(2)}KB)`,
        isBinary: true,
        size: stat.size,
      };
    }

    return {
      content: buffer.toString("utf-8"),
      isBinary: false,
      size: stat.size,
    };
  } catch (error) {
    throw new Error(`Failed to read file: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

/**
 * Get file extension for syntax highlighting
 */
export function getLanguageFromExtension(ext: string): string {
  const languageMap: Record<string, string> = {
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    py: "python",
    rb: "ruby",
    go: "go",
    rs: "rust",
    java: "java",
    c: "c",
    cpp: "cpp",
    cs: "csharp",
    php: "php",
    html: "html",
    css: "css",
    scss: "scss",
    json: "json",
    xml: "xml",
    yaml: "yaml",
    yml: "yaml",
    md: "markdown",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    sql: "sql",
    graphql: "graphql",
    vue: "vue",
    svelte: "svelte",
  };

  return languageMap[ext.toLowerCase()] || "plaintext";
}
