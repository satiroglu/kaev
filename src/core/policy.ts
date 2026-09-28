import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { KaevConfig, Suppression } from "../config/config.js";
import { KaevError } from "../shared/errors.js";
import type { Finding } from "./types.js";

export interface Baseline {
  version: 1;
  generatedAt: string;
  fingerprints: string[];
}

export function fingerprint(finding: Finding): string {
  return createHash("sha256")
    .update(
      [finding.ruleId, finding.file ?? "project", finding.title, finding.evidence ?? ""].join("\0"),
    )
    .digest("hex");
}

function glob(pattern: string, value: string): boolean {
  const source = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\0")
    .replace(/\*/g, "[^/]*")
    .replace(/\0/g, ".*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${source}$`).test(value);
}

function active(suppression: Suppression, now = new Date()): boolean {
  return !suppression.expires || suppression.expires >= now.toISOString().slice(0, 10);
}

export async function loadBaseline(root: string, file?: string): Promise<Baseline | undefined> {
  if (!file) return undefined;
  try {
    const parsed = JSON.parse(await readFile(path.resolve(root, file), "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    const value = parsed as Partial<Baseline>;
    if (
      value.version !== 1 ||
      !Array.isArray(value.fingerprints) ||
      value.fingerprints.length > 100_000 ||
      value.fingerprints.some((item) => typeof item !== "string" || !/^[a-f0-9]{64}$/.test(item))
    )
      throw new Error();
    return value as Baseline;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new KaevError("configuration", `${file} is not a valid Kaev baseline.`);
  }
}

export async function applyPolicy(
  findings: Finding[],
  root: string,
  config: KaevConfig,
): Promise<{ active: Finding[]; suppressed: Finding[] }> {
  const baseline = await loadBaseline(root, config.baseline);
  const known = new Set(baseline?.fingerprints ?? []);
  const suppressed: Finding[] = [];
  const remaining: Finding[] = [];
  for (const finding of findings) {
    const configured = (config.suppressions ?? []).some(
      (s) =>
        active(s) &&
        s.ruleId === finding.ruleId &&
        (!s.file || glob(s.file, finding.file ?? "project")),
    );
    if (configured || known.has(fingerprint(finding))) suppressed.push(finding);
    else remaining.push(finding);
  }
  return { active: remaining, suppressed };
}

export function createBaseline(findings: Finding[]): Baseline {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    fingerprints: [...new Set(findings.map(fingerprint))].sort(),
  };
}
