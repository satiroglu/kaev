import ts from "typescript";
import { literal, walk } from "../analysis/ast.js";
import { credentialPattern, secretName } from "../analysis/secrets.js";
import type { Workspace } from "../analysis/workspace.js";
import { type Finding, severities } from "./types.js";

// Raw source is never reported. Also collect credential values so an accidental
// reference through project metadata or paths is redacted before any reporter.
export function createRedactor(workspace: Workspace): (text: string) => string {
  const values = new Set<string>();
  for (const ast of workspace.ast.values())
    walk(ast, (n) => {
      if (
        (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) &&
        credentialPattern(n.text)
      )
        values.add(n.text);
      if (ts.isVariableDeclaration(n) || ts.isPropertyAssignment(n)) {
        const name = ts.isIdentifier(n.name) ? n.name.text : literal(n.name);
        const value = literal(n.initializer);
        if (name && secretName(name) && value && value.length >= 4) values.add(value);
      }
    });
  const collect = (v: unknown, depth: number, sensitive = false): void => {
    if (depth > 40) return;
    if (typeof v === "string" && v.length >= 4 && (sensitive || credentialPattern(v)))
      values.add(v);
    else if (Array.isArray(v)) {
      for (const x of v) collect(x, depth + 1, sensitive);
    } else if (v && typeof v === "object") {
      for (const [key, x] of Object.entries(v)) collect(x, depth + 1, sensitive || secretName(key));
    }
  };
  for (const data of workspace.data.values()) collect(data, 0);
  // Only credential-shaped values are globally replaced: ordinary UI5 identifiers and
  // paths must remain useful. Adapter messages omit arbitrary source text altogether.
  const secrets = [...values].sort((a, b) => b.length - a.length);
  return (text) => {
    let out = text;
    for (const secret of secrets) out = out.split(secret).join("[REDACTED]");
    // biome-ignore lint/suspicious/noControlCharactersInRegex: deliberately remove terminal escape sequences.
    out = out.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
    // biome-ignore lint/suspicious/noControlCharactersInRegex: remove untrusted control and bidi characters.
    out = out.replace(/[\x00-\x08\x0b-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, "");
    return out
      .replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]")
      .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/gi, "https://[REDACTED]@")
      .slice(0, 2000);
  };
}
export function processFindings(findings: Finding[], redact: (text: string) => string): Finding[] {
  const strong = new Set(
    findings
      .filter((f) => ["ZET-SEC-003", "ZET-SEC-008"].includes(f.ruleId))
      .map((f) => `${f.file}:${f.line}:${f.column}`),
  );
  const unique = new Map<string, Finding>();
  for (const f of findings) {
    if (
      ["ZET-ARCH-001", "ZET-ARCH-002"].includes(f.ruleId) &&
      strong.has(`${f.file}:${f.line}:${f.column}`)
    )
      continue;
    const sanitized = Object.fromEntries(
      Object.entries(f).map(([k, v]) => [k, typeof v === "string" ? redact(v) : v]),
    ) as unknown as Finding;
    unique.set(`${f.ruleId}:${f.file}:${f.line}:${f.column}`, sanitized);
  }
  const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  return [...unique.values()].sort(
    (a, b) =>
      severities.indexOf(b.severity) - severities.indexOf(a.severity) ||
      compare(a.category, b.category) ||
      compare(a.file ?? "", b.file ?? "") ||
      (a.line ?? 0) - (b.line ?? 0) ||
      compare(a.ruleId, b.ruleId) ||
      (a.column ?? 0) - (b.column ?? 0),
  );
}
