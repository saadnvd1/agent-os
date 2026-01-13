/**
 * File system utilities for file explorer (server-only)
 */

import { readdirSync, statSync, readFileSync, writeFileSync } from "fs";
import { join, extname } from "path";

// Re-export client-safe types and utilities
export type { FileNode } from "./file-utils";
export { getLanguageFromExtension } from "./file-utils";
import type { FileNode } from "./file-utils";

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
 * Write content to a file
 */
export function writeFileContent(
  filePath: string,
  content: string,
  options: { maxSize?: number } = {}
): { success: boolean; size: number } {
  const { maxSize = 1024 * 1024 } = options; // Default 1MB max

  const contentBuffer = Buffer.from(content, "utf-8");

  if (contentBuffer.length > maxSize) {
    throw new Error(
      `Content too large (${(contentBuffer.length / 1024 / 1024).toFixed(2)}MB). Maximum size: ${(maxSize / 1024 / 1024).toFixed(2)}MB`
    );
  }

  try {
    writeFileSync(filePath, content, "utf-8");
    return {
      success: true,
      size: contentBuffer.length,
    };
  } catch (error) {
    throw new Error(`Failed to write file: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

