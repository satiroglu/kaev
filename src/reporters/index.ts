import { type DisplayOptions, visibleFindings } from "../core/presentation.js";
import { references } from "../core/standards.js";
import { type AnalysisResult, categories, type Finding, type RuleStatus } from "../core/types.js";
import { messages } from "../i18n/en.js";
import { localIsoTimestamp } from "../shared/time.js";

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
const categoryNames: Record<(typeof categories)[number], string> = {
  project: "Project",
  config: "Configuration",
  ui5: "UI5",
  odata: "OData",
  architecture: "Architecture",
  performance: "Performance",
  security: "Security",
};
const checkNames: Record<string, string> = {
  "KAEV-PROJ-001": "UI5 project identification",
  "KAEV-CONFIG-001": "Manifest readability",
  "KAEV-CONFIG-002": "UI5 configuration availability",
  "KAEV-CONFIG-003": "UI5 configuration consistency",
  "KAEV-UI5-001": "Stable IDs for interactive controls",
  "KAEV-ODATA-001": "OData collection filtering",
  "KAEV-ODATA-002": "OData collection sorting",
  "KAEV-ODATA-003": "OData model size limits",
  "KAEV-ARCH-001": "UI5 model networking boundary",
  "KAEV-ARCH-002": "UI5-managed DOM rendering",
  "KAEV-PERF-001": "Model refresh placement",
  "KAEV-SEC-001": "Frontend credential exposure",
  "KAEV-SEC-002": "Sensitive browser storage",
  "KAEV-SEC-003": "Dynamic HTML sanitization",
  "KAEV-SEC-004": "Dynamic code execution",
  "KAEV-SEC-005": "Backend transport encryption",
  "KAEV-SEC-006": "Sensitive-value logging",
  "KAEV-SEC-007": "Backend authorization boundary",
  "KAEV-SEC-008": "CSRF protection for manual OData writes",
  "UI5-LINTER": "Official UI5 Linter",
};

function ruleFindings(r: AnalysisResult, ruleId: string): Finding[] {
  return r.findings.filter((finding) =>
    ruleId === "UI5-LINTER" ? finding.ruleId.startsWith("UI5LINT/") : finding.ruleId === ruleId,
  );
}

function ruleLabel(rule: RuleStatus): string {
  return checkNames[rule.ruleId] ?? rule.title ?? rule.ruleId;
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
  const displayed = visibleFindings(r, o);
  if (!o.quiet) lines.push(paint("Checks", "bold", color), "");
  for (const category of categories) {
    const rules = r.rules.filter((rule) => rule.category === category);
    const categoryFindings = displayed.filter((finding) => finding.category === category);
    if (!rules.length || (o.quiet && !categoryFindings.length)) continue;
    lines.push(paint(categoryNames[category], "cyan", color));
    for (const rule of rules) {
      const findings = ruleFindings(r, rule.ruleId);
      const visible = findings.filter((finding) => displayed.includes(finding));
      if (o.quiet && !visible.length) continue;
      if (rule.status === "evaluated" && findings.length > 0) {
        const highest = findings[0]?.severity ?? "info";
        lines.push(
          `  ${paint("✗ ISSUE", severityColor(highest), color)}  ${ruleLabel(rule)} ${paint(`· ${rule.ruleId} · ${findings.length} finding(s)`, "dim", color)}`,
        );
        for (const finding of visible) {
          lines.push(
            `      ${paint(finding.severity.toUpperCase(), severityColor(finding.severity), color)} · ${finding.confidence.toUpperCase()} confidence · ${paint(location(finding), "cyan", color)}`,
          );
          if (o.verbose)
            lines.push(
              `      ${finding.message}`,
              `      Basis: ${finding.basis}`,
              ...finding.referenceIds.map(
                (id) => `      Reference: ${references[id]?.title ?? id}`,
              ),
              `      Recommendation: ${finding.recommendation}`,
            );
        }
        if (!visible.length)
          lines.push(paint("      Findings hidden by the display severity filter.", "dim", color));
      } else if (rule.status === "evaluated" && (rule.suppressedCount ?? 0) > 0) {
        lines.push(
          `  ${paint("⊘ SUPPRESSED", "yellow", color)}  ${ruleLabel(rule)} ${paint(`· ${rule.ruleId} · ${rule.suppressedCount} finding(s)`, "dim", color)}`,
        );
      } else if (rule.status === "evaluated") {
        lines.push(
          `  ${paint("✓ PASS", "green", color)}  ${ruleLabel(rule)} ${paint(`· ${rule.ruleId}`, "dim", color)}`,
        );
      } else {
        const state =
          rule.status === "not-applicable"
            ? "− N/A"
            : rule.status === "skipped"
              ? "− SKIP"
              : "! UNAVAILABLE";
        lines.push(
          `  ${paint(state, rule.status === "unavailable" ? "red" : "dim", color)}  ${ruleLabel(rule)} ${paint(`· ${rule.ruleId}`, "dim", color)}`,
        );
        if (o.verbose && rule.reason) lines.push(`      ${rule.reason}`);
      }
    }
    lines.push("");
  }
  const health = r.scores.projectHealth;
  const security = r.scores.securityPosture;
  lines.push(
    `${paint("Project Health", "bold", color)} ${paint(`${health ?? "N/A"}/100`, scoreColor(health), color)} · ${paint("Security Posture", "bold", color)} ${paint(`${security ?? "N/A"}/100`, scoreColor(security), color)}`,
    `${r.summary.total} findings · ${r.summary.evaluated} evaluated · ${r.summary.notApplicable} not applicable · ${r.summary.skipped} skipped · ${r.summary.unavailable} unavailable`,
  );
  const passed = r.rules.filter(
    (rule) =>
      rule.status === "evaluated" && !(rule.findingCount ?? 0) && !(rule.suppressedCount ?? 0),
  ).length;
  const issues = r.rules.filter(
    (rule) => rule.status === "evaluated" && (rule.findingCount ?? 0) > 0,
  ).length;
  const suppressed = r.rules.filter((rule) => (rule.suppressedCount ?? 0) > 0).length;
  lines.push(
    `Checks: ${paint(String(passed), "green", color)} passed · ${paint(String(issues), issues ? "red" : "green", color)} with findings${suppressed ? ` · ${paint(String(suppressed), "yellow", color)} suppressed` : ""}`,
  );
  const counts = (["critical", "high", "medium", "low", "info"] as const)
    .filter((severity) => r.summary.counts[severity] > 0)
    .map(
      (severity) =>
        `${paint(String(r.summary.counts[severity]), severityColor(severity), color)} ${severity}`,
    );
  if (counts.length) lines.push(`Severity: ${counts.join(" · ")}`);
  const priorities = displayed.slice(0, 3);
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
  const failureRules = r.rules.filter((rule) =>
    ruleFindings(r, rule.ruleId).some((f) => ["high", "critical"].includes(f.severity)),
  );
  const errors = r.rules.filter((rule) => rule.status === "unavailable").length;
  const skipped = r.rules.filter(
    (rule) =>
      ["skipped", "not-applicable"].includes(rule.status) || (rule.suppressedCount ?? 0) > 0,
  ).length;
  const cases = r.rules
    .map((rule) => {
      const findings = ruleFindings(r, rule.ruleId);
      const attributes = `classname="kaev.${xml(rule.category ?? "project")}" name="${xml(`${rule.ruleId}: ${ruleLabel(rule)}`)}"`;
      if (rule.status === "unavailable")
        return `<testcase ${attributes}><error message="${xml(rule.reason ?? "Rule unavailable")}"/></testcase>`;
      if (["skipped", "not-applicable"].includes(rule.status))
        return `<testcase ${attributes}><skipped message="${xml(rule.reason ?? rule.status)}"/></testcase>`;
      if ((rule.suppressedCount ?? 0) > 0 && !findings.length)
        return `<testcase ${attributes}><skipped message="${rule.suppressedCount} finding(s) suppressed by policy/baseline"/></testcase>`;
      if (!findings.length) return `<testcase ${attributes}/>`;
      const detail = findings
        .map(
          (finding) =>
            `${finding.severity.toUpperCase()} ${location(finding)}: ${finding.message} ${finding.recommendation}`,
        )
        .join("\n");
      return failureRules.includes(rule)
        ? `<testcase ${attributes}><failure type="kaev-finding" message="${findings.length} finding(s)">${xml(detail)}</failure></testcase>`
        : `<testcase ${attributes}><system-out>${xml(detail)}</system-out></testcase>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites tests="${r.rules.length}" failures="${failureRules.length}" errors="${errors}" skipped="${skipped}"><testsuite name="Kaev" tests="${r.rules.length}" failures="${failureRules.length}" errors="${errors}" skipped="${skipped}">${cases}</testsuite></testsuites>\n`;
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
    `Version: ${r.kaevVersion} · Generated locally: ${localIsoTimestamp(r.generatedAt)} · UTC: ${r.generatedAt}`,
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
    "## Check results",
    "",
  ];
  for (const category of categories) {
    const rules = r.rules.filter((rule) => rule.category === category);
    if (!rules.length) continue;
    lines.push(
      `### ${categoryNames[category]}`,
      "",
      "| Status | Check | Details |",
      "| --- | --- | --- |",
    );
    for (const rule of rules) {
      const findings = ruleFindings(r, rule.ruleId);
      let status: string;
      let details: string;
      if (rule.status === "evaluated" && findings.length) {
        status = "ISSUE";
        details = `${findings.length} finding(s)`;
      } else if (rule.status === "evaluated" && (rule.suppressedCount ?? 0) > 0) {
        status = "SUPPRESSED";
        details = `${rule.suppressedCount} finding(s) suppressed by policy/baseline`;
      } else if (rule.status === "evaluated") {
        status = "PASS";
        details = "No finding detected";
      } else if (rule.status === "not-applicable") {
        status = "N/A";
        details = rule.reason ?? "Not applicable";
      } else if (rule.status === "skipped") {
        status = "SKIPPED";
        details = rule.reason ?? "Skipped";
      } else {
        status = "UNAVAILABLE";
        details = rule.reason ?? "Could not be evaluated";
      }
      lines.push(`| ${status} | ${e(ruleLabel(rule))} (${rule.ruleId}) | ${e(details)} |`);
    }
    lines.push("");
  }
  lines.push("## High-priority findings", "");
  const highPriority = r.findings.filter((f) => ["critical", "high"].includes(f.severity));
  for (const f of highPriority) lines.push(`- ${f.ruleId}: ${e(f.title)} (${e(location(f))})`);
  if (!highPriority.length) lines.push("- None.");
  for (const category of [...new Set(r.findings.map((f) => f.category))]) {
    lines.push("", `## Findings: ${categoryNames[category]}`, "");
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
  if (!r.diagnostics.length) lines.push("- None.");
  lines.push("", messages.privacy, "");
  return lines.join("\n");
}
