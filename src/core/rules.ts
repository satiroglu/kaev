import semver from "semver";
import type { Workspace } from "../analysis/workspace.js";
import type { Applicability, Finding, ProjectContext, RuleMetadata, RuleStatus } from "./types.js";
export interface RuleContext {
  project: ProjectContext;
  workspace: Workspace;
}
export interface Rule {
  readonly meta: RuleMetadata;
  run(context: RuleContext): Finding[] | Promise<Finding[]>;
}
export function applicability(a: Applicability | undefined, p: ProjectContext): string | undefined {
  if (!a) return;
  if (a.requiresUi5 && !p.detected) return "UI5 project evidence is required.";
  if (a.flexibility !== undefined && a.flexibility !== p.flexibility)
    return "Flexibility configuration does not match.";
  for (const [constraint, value] of [
    [a.frameworks, p.framework],
    [a.projectTypes, p.projectType],
    [a.appTypes, p.appType],
    [a.backend, p.backend],
    [a.deployment, p.deployment],
  ] as const) {
    if (constraint && !(constraint as readonly string[]).includes(value))
      return `Context ${value} does not match rule applicability.`;
  }
  if (a.odataVersions && p.odata !== "mixed" && !a.odataVersions.some((v) => v === p.odata))
    return "OData version does not match.";
  if (a.languages && p.language !== "mixed" && !a.languages.some((v) => v === p.language))
    return "Source language does not match.";
  for (const [range, version] of [
    [a.ui5Version, p.ui5Version],
    [a.ui5SpecVersion, p.ui5SpecVersion],
  ] as const) {
    if (!range) continue;
    const v = version && semver.coerce(version);
    if (!v) return "Required version is unknown.";
    if (range.min && semver.lt(v, semver.coerce(range.min) ?? range.min))
      return "Version is below rule minimum.";
    if (range.max && semver.gte(v, semver.coerce(range.max) ?? range.max))
      return "Version is at or above exclusive rule maximum.";
  }
}
export async function runRules(
  rules: readonly Rule[],
  context: RuleContext,
  category?: string,
): Promise<{ findings: Finding[]; statuses: RuleStatus[] }> {
  const findings: Finding[] = [];
  const statuses: RuleStatus[] = [];
  for (const rule of rules) {
    const status = (
      value: RuleStatus["status"],
      reason?: string,
      findingCount?: number,
    ): RuleStatus => ({
      ruleId: rule.meta.id,
      title: rule.meta.title,
      category: rule.meta.category,
      status: value,
      ...(reason ? { reason } : {}),
      ...(findingCount !== undefined ? { findingCount } : {}),
    });
    if (category && category !== rule.meta.category) {
      statuses.push(status("skipped", "Category filter."));
      continue;
    }
    const reason = applicability(rule.meta.applicability, context.project);
    if (reason) {
      statuses.push(status("not-applicable", reason));
      continue;
    }
    try {
      const result = await rule.run(context);
      findings.push(...result);
      statuses.push(status("evaluated", undefined, result.length));
    } catch {
      statuses.push(
        status("unavailable", "Rule failed; details withheld to protect source content."),
      );
    }
  }
  return { findings, statuses };
}
