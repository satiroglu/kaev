import { lintUi5 } from "../adapters/ui5-linter/index.js";
import { Workspace } from "../analysis/workspace.js";
import { createRedactor, processFindings } from "../core/processing.js";
import { runRules } from "../core/rules.js";
import { scoring } from "../core/scoring.js";
import { type AnalysisResult, type Category, severities } from "../core/types.js";
import { detectProject } from "../detectors/project.js";
import { discover } from "../filesystem/discovery.js";
import { projectRules } from "../rules/project.js";
import { sourceRules } from "../rules/source.js";
import { VERSION } from "../shared/errors.js";

export async function prepare(root: string) {
  const discovered = await discover(root);
  const workspace = new Workspace(discovered.files, discovered.diagnostics);
  const project = detectProject(discovered.root, workspace);
  return { project, workspace };
}
export async function analyzeProject(
  root: string,
  options: { category?: Category; ui5Lint?: boolean } = {},
): Promise<AnalysisResult> {
  const context = await prepare(root);
  const { findings, statuses } = await runRules(
    [...projectRules, ...sourceRules],
    context,
    options.category,
  );
  if (options.ui5Lint !== false && (!options.category || options.category === "ui5")) {
    const external = await lintUi5(context);
    findings.push(...external.findings);
    statuses.push(external.status);
  } else statuses.push({ ruleId: "UI5-LINTER", status: "skipped", reason: "Disabled by options." });
  const redact = createRedactor(context.workspace);
  const processed = processFindings(findings, redact);
  const { rootPath: _root, services: _services, models: _models, ...project } = context.project;
  const diagnostics = context.workspace.diagnostics.map((d) => ({
    ...d,
    file: d.file && redact(d.file),
    message: redact(d.message),
  }));
  if (project.packageName) project.packageName = redact(project.packageName);
  const counts = Object.fromEntries(
    severities.map((s) => [s, processed.filter((f) => f.severity === s).length]),
  ) as AnalysisResult["summary"]["counts"];
  return {
    schemaVersion: 1,
    kaevVersion: VERSION,
    generatedAt: new Date().toISOString(),
    project,
    findings: processed,
    diagnostics,
    rules: statuses,
    scores: {
      projectHealth: project.detected ? scoring.score(processed) : null,
      securityPosture:
        project.detected && (!options.category || options.category === "security")
          ? scoring.score(processed.filter((f) => f.category === "security"))
          : null,
      partial:
        !!options.category ||
        diagnostics.length > 0 ||
        statuses.some((s) => s.status === "unavailable" || s.status === "skipped"),
    },
    summary: {
      total: processed.length,
      counts,
      files: context.workspace.files.length,
      evaluated: statuses.filter((s) => s.status === "evaluated").length,
      skipped: statuses.filter((s) => s.status === "skipped").length,
      notApplicable: statuses.filter((s) => s.status === "not-applicable").length,
      unavailable: statuses.filter((s) => s.status === "unavailable").length,
    },
  };
}
