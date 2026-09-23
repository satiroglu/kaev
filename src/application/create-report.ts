import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import type { AnalysisResult } from "../core/types.js";
import { json, markdown } from "../reporters/index.js";
import { KaevError } from "../shared/errors.js";
export async function createReport(
  result: AnalysisResult,
  root: string,
  format: "json" | "markdown",
  output?: string,
): Promise<string> {
  const extension = format === "json" ? ".json" : ".md";
  const name = (result.project.packageName ?? "project")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 80);
  const target = path.resolve(root, output ?? `kaev-report-${name}${extension}`);
  if (path.extname(target).toLowerCase() !== extension)
    throw new KaevError("output", `Report output must use ${extension}.`);
  // Require an existing, non-symlink parent; never create directories implicitly.
  let current = path.dirname(target);
  try {
    while (true) {
      if ((await lstat(current)).isSymbolicLink())
        throw new KaevError("output", "Report parent directories must not be symbolic links.");
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    const canonicalParent = await realpath(path.dirname(target));
    const handle = await open(path.join(canonicalParent, path.basename(target)), "wx", 0o600);
    try {
      await handle.writeFile(format === "json" ? json(result) : markdown(result), "utf8");
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error instanceof KaevError) throw error;
    throw new KaevError(
      "output",
      "Report could not be created. Ensure its parent exists and the target does not already exist. Existing files are never overwritten.",
    );
  }
  return target;
}
