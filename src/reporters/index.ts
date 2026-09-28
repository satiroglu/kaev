import { type DisplayOptions, visibleFindings } from "../core/presentation.js";
import { references } from "../core/standards.js";
import type { AnalysisResult, Finding } from "../core/types.js";
import { messages } from "../i18n/en.js";

function location(f: Finding): string {
  return f.file ? `${f.file}${f.line ? `:${f.line}:${f.column ?? 1}` : ""}` : "project";
}
const ansi = {
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
} as const;

function paint(value: string, color: keyof typeof ansi, enabled = false): string {
  return enabled ? `${ansi[color]}${value}${ansi.reset}` : value;
}

function severityColor(severity: Finding["severity"]): keyof typeof ansi {
  if (severity === "critical") return "magenta";
  if (severity === "high") return "red";
  if (severity === "medium") return "yellow";
  if (severity === "low") return "cyan";
  return "dim";
}

function scoreColor(score: number | null): keyof typeof ansi {
  if (score === null || score < 70) return "red";
  if (score < 90) return "yellow";
  return "green";
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
  const color = o.color === true;
  const lines = o.quiet
    ? []
    : [
        paint(`KAEV v${r.kaevVersion}`, "bold", color),
        "",
        `${paint(r.project.packageName ?? "Project", "cyan", color)} · ${r.project.framework} ${r.project.projectType}`,
        `UI5 ${r.project.ui5Version ?? "unknown"} · CLI spec ${r.project.ui5SpecVersion ?? "unknown"} · ${r.project.appType} · ${r.project.language} · OData ${r.project.odata}`,
        ...(r.project.legacy ? ["Legacy UI5 project detected"] : []),
        "",
      ];
  for (const f of visibleFindings(r, o)) {
    lines.push(
      `${paint(f.severity.toUpperCase(), severityColor(f.severity), color)} · ${f.confidence.toUpperCase()} confidence · ${paint(f.title, "bold", color)}`,
      `  ${paint(location(f), "cyan", color)} · ${paint(f.ruleId, "dim", color)}`,
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
  const health = r.scores.projectHealth;
  const security = r.scores.securityPosture;
  lines.push(
    `${paint("Project Health", "bold", color)} ${paint(`${health ?? "N/A"}/100`, scoreColor(health), color)} · ${paint("Security Posture", "bold", color)} ${paint(`${security ?? "N/A"}/100`, scoreColor(security), color)}`,
    `${r.summary.total} findings · ${r.summary.evaluated} evaluated · ${r.summary.notApplicable} not applicable · ${r.summary.skipped} skipped · ${r.summary.unavailable} unavailable`,
  );
  const counts = (["critical", "high", "medium", "low", "info"] as const)
    .filter((severity) => r.summary.counts[severity] > 0)
    .map(
      (severity) =>
        `${paint(String(r.summary.counts[severity]), severityColor(severity), color)} ${severity}`,
    );
  if (counts.length) lines.push(`Severity: ${counts.join(" · ")}`);
  const priorities = visibleFindings(r, o).slice(0, 3);
  if (priorities.length) {
    lines.push("", paint("Top priorities", "bold", color));
    for (const finding of priorities)
      lines.push(
        `  ${paint(finding.ruleId, severityColor(finding.severity), color)} · ${finding.title}`,
      );
  }
  if (r.scores.partial) lines.push(paint(messages.partial, "yellow", color));
  for (const d of r.diagnostics)
    if (o.verbose || ["parse", "configuration", "filesystem"].includes(d.code))
      lines.push(paint(`Diagnostic: ${d.file ?? "project"}: ${d.message}`, "yellow", color));
  if (o.verbose) {
    lines.push(
      `Source roots: ${r.project.sourceRoots.join(", ") || "unresolved"}`,
      `Evidence: ${r.project.evidence.join(", ") || "insufficient"}`,
    );
    for (const s of r.rules)
      if (s.status !== "evaluated") lines.push(`${s.ruleId}: ${s.status} (${s.reason})`);
  }
  lines.push(paint(messages.limitation, "dim", color));
  return `${lines.join("\n")}\n`;
}

function xml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function junit(r: AnalysisResult): string {
  const failures = r.findings.filter((f) => ["high", "critical"].includes(f.severity)).length;
  const cases = r.findings
    .map((f) => {
      const detail = `${f.message}\n${f.recommendation}`;
      const failure = ["high", "critical"].includes(f.severity)
        ? `<failure type="${xml(f.severity)}" message="${xml(f.title)}">${xml(detail)}</failure>`
        : `<system-out>${xml(detail)}</system-out>`;
      return `<testcase classname="kaev.${xml(f.category)}" name="${xml(f.ruleId)}" file="${xml(f.file ?? "project")}"${f.line ? ` line="${f.line}"` : ""}>${failure}</testcase>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites tests="${r.findings.length}" failures="${failures}"><testsuite name="Kaev" tests="${r.findings.length}" failures="${failures}">${cases}</testsuite></testsuites>\n`;
}

export function sarif(r: AnalysisResult): string {
  const rules = [...new Map(r.findings.map((f) => [f.ruleId, f])).values()].map((f) => ({
    id: f.ruleId,
    name: f.title,
    shortDescription: { text: f.title },
    fullDescription: { text: f.whyItMatters },
    help: { text: f.recommendation },
    properties: { category: f.category, basis: f.basis, severity: f.severity },
  }));
  const level = (severity: Finding["severity"]): "error" | "warning" | "note" =>
    ["critical", "high"].includes(severity) ? "error" : severity === "medium" ? "warning" : "note";
  const results = r.findings.map((f) => ({
    ruleId: f.ruleId,
    level: level(f.severity),
    message: { text: `${f.message} ${f.recommendation}` },
    locations: f.file
      ? [
          {
            physicalLocation: {
              artifactLocation: { uri: f.file, uriBaseId: "%SRCROOT%" },
              region: { startLine: f.line ?? 1, startColumn: f.column ?? 1 },
            },
          },
        ]
      : undefined,
    properties: { severity: f.severity, confidence: f.confidence, basis: f.basis },
  }));
  return `${JSON.stringify(
    {
      $schema:
        "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/Schemata/sarif-schema-2.1.0.json",
      version: "2.1.0",
      runs: [
        {
          tool: { driver: { name: "Kaev", version: r.kaevVersion, rules } },
          originalUriBaseIds: { "%SRCROOT%": { uri: "./" } },
          results,
        },
      ],
    },
    null,
    2,
  )}\n`;
}

function workflow(value: string): string {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}
function workflowProperty(value: string): string {
  return workflow(value).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

export function github(r: AnalysisResult): string {
  return `${r.findings
    .map((f) => {
      const command = ["critical", "high"].includes(f.severity)
        ? "error"
        : f.severity === "medium"
          ? "warning"
          : "notice";
      const properties = [
        f.file ? `file=${workflowProperty(f.file)}` : undefined,
        f.line ? `line=${f.line}` : undefined,
        f.column ? `col=${f.column}` : undefined,
        `title=${workflowProperty(`${f.ruleId}: ${f.title}`)}`,
      ]
        .filter(Boolean)
        .join(",");
      return `::${command} ${properties}::${workflow(`${f.message} ${f.recommendation}`)}`;
    })
    .join("\n")}\n`;
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
