import { readFile } from "node:fs/promises";
import path from "node:path";
import { type Category, categories, type Severity, severities } from "../core/types.js";
import { KaevError } from "../shared/errors.js";

export const CONFIG_FILE = ".kaevrc.json";

export interface Suppression {
  ruleId: string;
  file?: string;
  reason: string;
  expires?: string;
}

export interface KaevConfig {
  version: 1;
  category?: Category;
  severity?: Severity;
  failOn?: Severity | "none";
  ui5Lint?: boolean;
  color?: "auto" | "always" | "never";
  baseline?: string;
  exclude?: string[];
  suppressions?: Suppression[];
}

const keys = new Set([
  "version",
  "category",
  "severity",
  "failOn",
  "ui5Lint",
  "color",
  "baseline",
  "exclude",
  "suppressions",
]);

function invalid(message: string): never {
  throw new KaevError("configuration", `${CONFIG_FILE}: ${message}`);
}

function validate(value: unknown): KaevConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("must be an object.");
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input)) if (!keys.has(key)) invalid(`unknown property ${key}.`);
  if (input.version !== 1) invalid("version must be 1.");
  if (input.category !== undefined && !categories.includes(input.category as Category))
    invalid("category is invalid.");
  if (input.severity !== undefined && !severities.includes(input.severity as Severity))
    invalid("severity is invalid.");
  if (
    input.failOn !== undefined &&
    input.failOn !== "none" &&
    !severities.includes(input.failOn as Severity)
  )
    invalid("failOn is invalid.");
  if (input.ui5Lint !== undefined && typeof input.ui5Lint !== "boolean")
    invalid("ui5Lint must be boolean.");
  if (input.color !== undefined && !["auto", "always", "never"].includes(String(input.color)))
    invalid("color must be auto, always, or never.");
  if (input.baseline !== undefined && typeof input.baseline !== "string")
    invalid("baseline must be a relative path.");
  if (typeof input.baseline === "string" && !safeConfigPath(input.baseline))
    invalid("baseline must be a safe relative path.");
  if (
    input.exclude !== undefined &&
    (!Array.isArray(input.exclude) ||
      input.exclude.length > 100 ||
      input.exclude.some(
        (item) => typeof item !== "string" || item.length > 200 || item.includes("\0"),
      ))
  )
    invalid("exclude must contain at most 100 bounded patterns.");
  if (input.suppressions !== undefined) {
    if (!Array.isArray(input.suppressions) || input.suppressions.length > 1_000)
      invalid("suppressions must contain at most 1000 entries.");
    for (const item of input.suppressions) {
      if (!item || typeof item !== "object" || Array.isArray(item))
        invalid("each suppression must be an object.");
      const s = item as Record<string, unknown>;
      if (Object.keys(s).some((key) => !["ruleId", "file", "reason", "expires"].includes(key)))
        invalid("suppression contains an unknown property.");
      if (typeof s.ruleId !== "string" || !s.ruleId || s.ruleId.length > 200)
        invalid("suppression ruleId is required.");
      if (typeof s.reason !== "string" || !s.reason.trim() || s.reason.length > 1000)
        invalid("suppression reason is required.");
      if (s.file !== undefined && (typeof s.file !== "string" || s.file.length > 500))
        invalid("suppression file must be a string.");
      if (s.expires !== undefined) {
        if (
          typeof s.expires !== "string" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(s.expires) ||
          Number.isNaN(Date.parse(`${s.expires}T00:00:00Z`))
        )
          invalid("suppression expires must use YYYY-MM-DD.");
      }
    }
  }
  return input as unknown as KaevConfig;
}

export function safeConfigPath(value: string): boolean {
  return (
    value.length > 0 &&
    !path.isAbsolute(value) &&
    !/^[A-Za-z]:/.test(value) &&
    !value.includes("\\") &&
    !value.split("/").includes("..") &&
    !value.includes("\0")
  );
}

export async function loadConfig(root: string, explicit?: string): Promise<KaevConfig | undefined> {
  const target = path.resolve(root, explicit ?? CONFIG_FILE);
  if (explicit && path.dirname(target) !== path.resolve(root))
    throw new KaevError("configuration", "--config must name a file in the project root.");
  try {
    const text = await readFile(target, "utf8");
    return validate(JSON.parse(text));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && !explicit) return undefined;
    if (error instanceof KaevError) throw error;
    throw new KaevError("configuration", `${path.basename(target)} could not be parsed.`);
  }
}

export const defaultConfig: KaevConfig = {
  version: 1,
  failOn: "high",
  color: "auto",
  baseline: ".kaev-baseline.json",
  exclude: [],
  suppressions: [],
};
