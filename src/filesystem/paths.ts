import path from "node:path";

/**
 * Normalizes a workspace file path to use POSIX "/" separators.
 * Normalizes at the boundary where files enter the workspace.
 */
export function normalizeWorkspacePath(value: string): string {
  if (!value || value.includes("\0")) return "";
  const cleaned = value.replace(/^\.[/\\]/, "");
  // On Windows or when backslashes are present as directory separators
  return cleaned.split(/[/\\]+/).join("/");
}

/**
 * Resolves a path strictly within a project root.
 * Rejects traversal, drive-letter escapes, UNC paths, and absolute paths.
 * Returns the resolved path or null if invalid or escaping.
 */
export function resolveWithinRoot(root: string, relativePath: string): string | null {
  if (!relativePath || relativePath.includes("\0")) return null;
  // Reject absolute paths, Windows drive letters, and UNC paths
  if (
    path.isAbsolute(relativePath) ||
    /^[A-Za-z]:/.test(relativePath) ||
    relativePath.startsWith("\\\\") ||
    relativePath.startsWith("//")
  ) {
    return null;
  }
  const canonicalRoot = path.resolve(root);
  const resolvedTarget = path.resolve(canonicalRoot, relativePath);
  const rel = path.relative(canonicalRoot, resolvedTarget);
  // Check traversal by path segments, not merely startsWith("..")
  // Ensures "..safe/file" is not incorrectly treated as traversal
  const segments = rel.split(path.sep);
  if (segments.includes("..") || path.isAbsolute(rel) || rel.startsWith(`..${path.sep}`)) {
    return null;
  }
  return resolvedTarget;
}

/**
 * Validates that an argument refers to a single direct file in the project root.
 * Used for --config and --baseline arguments.
 */
export function validateRootFileName(fileName: string): boolean {
  if (typeof fileName !== "string" || !fileName || fileName.includes("\0")) return false;
  // Reject Windows drive letters, UNC, and absolute paths
  if (
    /^[A-Za-z]:/.test(fileName) ||
    fileName.startsWith("\\\\") ||
    fileName.startsWith("//") ||
    fileName.startsWith("/")
  ) {
    return false;
  }
  const stripped = fileName.replace(/^\.[/\\]/, "");
  if (!stripped || stripped === "." || stripped === "..") return false;
  // Must not contain any directory separators
  if (stripped.includes("/") || stripped.includes("\\")) return false;
  return true;
}

/**
 * Normalizes paths returned by external tools (e.g. UI5 Linter) to POSIX workspace paths.
 * Rejects findings outside the project root.
 */
export function normalizeExternalFindingPath(
  projectRoot: string,
  externalPath: string,
): string | null {
  if (!externalPath || externalPath.includes("\0")) return null;
  const canonicalRoot = path.resolve(projectRoot);
  const resolved = path.isAbsolute(externalPath)
    ? path.resolve(externalPath)
    : path.resolve(canonicalRoot, externalPath);
  const rel = path.relative(canonicalRoot, resolved);
  const segments = rel.split(path.sep);
  if (segments.includes("..") || path.isAbsolute(rel) || rel.startsWith(`..${path.sep}`)) {
    return null;
  }
  return rel.split(path.sep).join("/");
}

/**
 * Validates manifest-provided or ui5.yaml source roots (e.g. webapp: "client/app").
 */
export function validateSourceRoot(value: string): boolean {
  if (typeof value !== "string" || !value || value.includes("\0")) return false;
  if (
    path.isAbsolute(value) ||
    /^[A-Za-z]:/.test(value) ||
    value.startsWith("\\\\") ||
    value.startsWith("//")
  ) {
    return false;
  }
  const segments = value.split(/[/\\]/);
  return !segments.includes("..");
}
