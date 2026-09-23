import type { Rule, RuleContext } from "../core/rules.js";
import type { Basis, Category, Finding, Severity } from "../core/types.js";
export interface Definition {
  id: string;
  title: string;
  category: Category;
  severity: Severity;
  basis: Basis;
  why: string;
  recommendation: string;
  references?: string[];
}
export function define(
  d: Definition,
  run: (c: RuleContext, finding: (extra?: Partial<Finding>) => Finding) => Finding[],
  applicability?: Rule["meta"]["applicability"],
): Rule {
  return {
    meta: {
      id: d.id,
      title: d.title,
      description: d.why,
      category: d.category,
      defaultSeverity: d.severity,
      basis: d.basis,
      references: d.references ?? [],
      applicability,
      docs: { path: `/rules/${d.id}` },
    },
    run: (c) =>
      run(c, (extra) => ({
        ruleId: d.id,
        title: d.title,
        message: d.title,
        category: d.category,
        severity: d.severity,
        basis: d.basis,
        confidence: "high",
        kind:
          d.category === "security"
            ? "security"
            : d.category === "architecture"
              ? "architecture"
              : d.category === "odata" || d.category === "performance"
                ? "performance"
                : "configuration",
        whyItMatters: d.why,
        recommendation: d.recommendation,
        origin: "application",
        referenceIds: d.references ?? [],
        ...extra,
      })),
  };
}
