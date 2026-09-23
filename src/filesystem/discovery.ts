import { constants, type Dirent } from "node:fs";
import { open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { Diagnostic } from "../core/types.js";
import { KaevError } from "../shared/errors.js";

export interface SourceFile {
  path: string;
  text: string;
  origin: "application";
}
const ignored = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".tmp",
  "tmp",
  "temp",
  ".cache",
  ".next",
  "vendor",
  "thirdparty",
  "generated",
  "test",
  "tests",
  "__tests__",
  "fixtures",
]);
const extensions = new Set([
  ".js",
  ".ts",
  ".mjs",
  ".cjs",
  ".json",
  ".yaml",
  ".yml",
  ".xml",
  ".html",
]);
export function safeRelative(value: string): boolean {
  return (
    !path.isAbsolute(value) &&
    !/^[A-Za-z]:/.test(value) &&
    !value.includes("\\") &&
    !value.split("/").includes("..") &&
    !value.includes("\0")
  );
}
export async function discover(
  root: string,
): Promise<{ root: string; files: SourceFile[]; diagnostics: Diagnostic[] }> {
  let canonical: string;
  try {
    canonical = await realpath(root);
  } catch {
    throw new KaevError("filesystem", "Project directory is not accessible.");
  }
  const files: SourceFile[] = [];
  const diagnostics: Diagnostic[] = [];
  let entriesSeen = 0;
  let bytes = 0;
  async function walk(relative: string, depth: number): Promise<void> {
    if (depth > 32 || entriesSeen > 30000 || bytes > 50 * 1024 * 1024) {
      diagnostics.push({
        code: "limit",
        file: relative,
        message: "Discovery safety limit reached; analysis is partial.",
      });
      return;
    }
    let entries: Dirent[];
    try {
      entries = await readdir(path.join(canonical, relative), { withFileTypes: true });
    } catch {
      diagnostics.push({
        code: "filesystem",
        file: relative,
        message: "Directory could not be read.",
      });
      return;
    }
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      if (++entriesSeen > 30000) {
        diagnostics.push({ code: "limit", message: "Entry limit reached; analysis is partial." });
        return;
      }
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) {
        diagnostics.push({ code: "symlink", file: name, message: "Symbolic link excluded." });
        continue;
      }
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name) && !entry.name.startsWith(".")) await walk(name, depth + 1);
        continue;
      }
      if (
        !entry.isFile() ||
        !extensions.has(path.extname(name)) ||
        /(?:\.min\.js|\.d\.ts|Component-preload\.js|library-preload\.js|package-lock\.json)$/.test(
          name,
        )
      )
        continue;
      if (bytes >= 50 * 1024 * 1024) {
        if (!diagnostics.some((d) => d.code === "byte-limit"))
          diagnostics.push({
            code: "byte-limit",
            message: "Total source byte limit reached; remaining files excluded.",
          });
        continue;
      }
      try {
        const handle = await open(
          path.join(canonical, name),
          constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
        );
        try {
          const stat = await handle.stat();
          if (!stat.isFile() || stat.size > 1024 * 1024) {
            diagnostics.push({
              code: "limit",
              file: name,
              message: "File exceeds 1 MiB limit or is not regular.",
            });
            continue;
          }
          const buffer = Buffer.alloc(Math.min(stat.size + 1, 1024 * 1024 + 1));
          let bytesRead = 0;
          while (bytesRead < buffer.length) {
            const chunk = await handle.read(
              buffer,
              bytesRead,
              buffer.length - bytesRead,
              bytesRead,
            );
            if (!chunk.bytesRead) break;
            bytesRead += chunk.bytesRead;
          }
          bytes += bytesRead;
          if (bytesRead > 1024 * 1024 || buffer.subarray(0, bytesRead).includes(0)) {
            diagnostics.push({
              code: "binary",
              file: name,
              message: "Binary or oversized file excluded.",
            });
            continue;
          }
          files.push({
            path: name,
            text: buffer.subarray(0, bytesRead).toString("utf8"),
            origin: "application",
          });
        } finally {
          await handle.close();
        }
      } catch {
        diagnostics.push({
          code: "filesystem",
          file: name,
          message: "File could not be read safely.",
        });
      }
    }
  }
  await walk("", 0);
  return { root: canonical, files, diagnostics };
}
