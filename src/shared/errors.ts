import { createRequire } from "node:module";

export class KaevError extends Error {
  constructor(
    public readonly code: "filesystem" | "configuration" | "output" | "internal",
    message: string,
  ) {
    super(message);
    this.name = "KaevError";
  }
}
export const EXIT = { success: 0, threshold: 1, failure: 2 } as const;

function resolvePackageVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("../../package.json") as { version?: string };
    return typeof pkg?.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const VERSION = resolvePackageVersion();
