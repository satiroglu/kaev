import { type DisplayOptions, visibleFindings } from "../core/presentation.js";
import { references } from "../core/standards.js";
import type { AnalysisResult, Finding } from "../core/types.js";
import { messages } from "../i18n/en.js";

function location(f: Finding): string {
  return f.file ? `${f.file}${f.line ? `:${f.line}:${f.column ?? 1}` : ""}` : "project";
}
export function json(r: AnalysisResult, o: DisplayOptions = {}): string {
  const findings = visibleFindings(r, o);
  const display = {
    minimumSeverity: o.severity ?? (o.quiet ? "high" : "info"),
    shown: findings.length,
    total: r.findings.length,
  };
  return `${JSON.stringify({ ...r, findings, display }, null, 2)}\n`;
}
export function terminal(r: AnalysisResult, o: DisplayOptions = {}): string {
  const lines = o.quiet
    ? []
    : [
        `KAEV v${r.kaevVersion}`,
        "",
        `${r.project.packageName ?? "Project"} · ${r.project.framework} ${r.project.projectType}`,
        `UI5 ${r.project.ui5Version ?? "unknown"} · CLI spec ${r.project.ui5SpecVersion ?? "unknown"} · ${r.project.appType} · ${r.project.language} · OData ${r.project.odata}`,
        ...(r.project.legacy ? ["Legacy UI5 project detected"] : []),
        "",
      ];
  for (const f of visibleFindings(r, o)) {
    lines.push(
      `${f.severity.toUpperCase()} · ${f.confidence.toUpperCase()} confidence · ${f.title}`,
      `  ${location(f)} · ${f.ruleId}`,
    );
    if (o.verbose)
      lines.push(
        `  ${f.message}`,
        `  Basis: ${f.basis}`,
        ...f.referenceIds.map((id) => `  Reference: ${references[id]?.title ?? id}`),
        `  ${f.recommendation}`,
      );
    lines.push("");
  }
  lines.push(
    `Project Health ${r.scores.projectHealth ?? "N/A"}/100 · Security Posture ${r.scores.securityPosture ?? "N/A"}/100`,
    `${r.summary.total} findings · ${r.summary.evaluated} evaluated · ${r.summary.notApplicable} not applicable · ${r.summary.skipped} skipped · ${r.summary.unavailable} unavailable`,
  );
  if (r.scores.partial) lines.push(messages.partial);
  for (const d of r.diagnostics)
    if (o.verbose || ["parse", "configuration", "filesystem"].includes(d.code))
      lines.push(`Diagnostic: ${d.file ?? "project"}: ${d.message}`);
  if (o.verbose) {
    lines.push(
      `Source roots: ${r.project.sourceRoots.join(", ") || "unresolved"}`,
      `Evidence: ${r.project.evidence.join(", ") || "insufficient"}`,
    );
    for (const s of r.rules)
      if (s.status !== "evaluated") lines.push(`${s.ruleId}: ${s.status} (${s.reason})`);
  }
  lines.push(messages.limitation);
  return `${lines.join("\n")}\n`;
}
function escapeMarkdown(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\\`*_{}[\]()#+.!|~-]/g, "\\$&")
    .replace(/\r?\n/g, " ");
}
export function markdown(r: AnalysisResult): string {
  const e = escapeMarkdown;
  const lines = [
    `# Kaev project report`,
    "",
    `Version: ${r.kaevVersion} · Generated: ${r.generatedAt}`,
    "",
    `Project: ${e(r.project.packageName ?? "unnamed")}`,
    "",
    `Fingerprint: ${r.project.framework} / ${r.project.projectType} / ${r.project.appType} / ${r.project.language} / OData ${r.project.odata}`,
    "",
    `UI5 runtime: ${e(r.project.ui5Version ?? "unknown")} · CLI spec: ${e(r.project.ui5SpecVersion ?? "unknown")}`,
    "",
    `Source roots: ${r.project.sourceRoots.map(e).join(", ")}`,
    "",
    `Project Health: ${r.scores.projectHealth ?? "N/A"}/100`,
    "",
    `Security Posture: ${r.scores.securityPosture ?? "N/A"}/100`,
    "",
    ...(r.scores.partial ? [messages.partial, ""] : []),
    messages.limitation,
    "",
    "## High-priority findings",
    "",
  ];
  for (const f of r.findings.filter((f) => ["critical", "high"].includes(f.severity)))
    lines.push(`- ${f.ruleId}: ${e(f.title)} (${e(location(f))})`);
  for (const category of [...new Set(r.findings.map((f) => f.category))]) {
    lines.push("", `## ${category}`, "");
    for (const f of r.findings.filter((f) => f.category === category))
      lines.push(
        `### ${f.ruleId} — ${e(f.title)}`,
        "",
        `Severity: ${f.severity} · Confidence: ${f.confidence} · Basis: ${f.basis}`,
        "",
        `Location: ${e(location(f))}`,
        "",
        e(f.message),
        "",
        `Why it matters: ${e(f.whyItMatters)}`,
        "",
        `Recommendation: ${e(f.recommendation)}`,
        "",
        ...(f.evidence ? [`Evidence: ${e(f.evidence)}`, ""] : []),
        ...f.referenceIds.map((id) => `Reference: ${e(references[id]?.title ?? id)}`),
      );
  }
  lines.push(
    "",
    "## Analysis statistics",
    "",
    `${r.summary.total} findings in ${r.summary.files} files. ${r.summary.evaluated} rules evaluated; ${r.summary.notApplicable} not applicable; ${r.summary.skipped} skipped; ${r.summary.unavailable} unavailable.`,
    "",
    "## Diagnostics",
    "",
  );
  for (const d of r.diagnostics) lines.push(`- ${e(d.file ?? "project")}: ${e(d.message)}`);
  for (const s of r.rules.filter((s) => s.status !== "evaluated"))
    lines.push(`- ${s.ruleId}: ${s.status} — ${e(s.reason ?? "")}`);
  lines.push("", messages.privacy, "");
  return lines.join("\n");
}
