export const categories = [
  "project",
  "config",
  "ui5",
  "odata",
  "architecture",
  "performance",
  "security",
] as const;
export type Category = (typeof categories)[number];
export const severities = ["info", "low", "medium", "high", "critical"] as const;
export type Severity = (typeof severities)[number];
export type Basis = "official" | "derived" | "heuristic";
export interface ProjectContext {
  rootPath: string;
  packageName?: string;
  framework: "sapui5" | "openui5" | "unknown";
  detected: boolean;
  ui5Version?: string;
  minimumUi5Version?: string;
  ui5SpecVersion?: string;
  ui5CliVersion?: string;
  ui5CliVersionRange?: string;
  projectType: "application" | "component" | "library" | "theme-library" | "module" | "unknown";
  appType: "freestyle" | "fiori-elements" | "unknown";
  language: "javascript" | "typescript" | "mixed" | "unknown";
  odata: "v2" | "v4" | "mixed" | "none" | "unknown";
  backend: "abap" | "cap" | "unknown";
  deployment: "abap-repository" | "btp-html5" | "unknown";
  sourceRoots: string[];
  legacy: boolean;
  evidence: string[];
  files: Record<string, boolean>;
  services: string[];
  models: Record<string, "v2" | "v4">;
  flexibility: boolean;
}
export interface Finding {
  ruleId: string;
  category: Category;
  kind:
    | "defect"
    | "security"
    | "performance"
    | "architecture"
    | "maintainability"
    | "configuration"
    | "modernization";
  severity: Severity;
  confidence: "low" | "medium" | "high";
  title: string;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  evidence?: string;
  whyItMatters: string;
  recommendation: string;
  basis: Basis;
  referenceIds: string[];
  origin: "application" | "generated" | "dependency" | "unknown";
}
export interface Applicability {
  requiresUi5?: boolean;
  flexibility?: boolean;
  frameworks?: ProjectContext["framework"][];
  projectTypes?: ProjectContext["projectType"][];
  appTypes?: ProjectContext["appType"][];
  odataVersions?: ("v2" | "v4")[];
  languages?: ("javascript" | "typescript")[];
  backend?: ProjectContext["backend"][];
  deployment?: ProjectContext["deployment"][];
  ui5Version?: { min?: string; max?: string };
  ui5SpecVersion?: { min?: string; max?: string };
}
export interface RuleMetadata {
  id: string;
  title: string;
  description: string;
  category: Category;
  defaultSeverity: Severity;
  basis: Basis;
  references: string[];
  applicability?: Applicability;
  docs: { path: string };
}
export interface Diagnostic {
  code: string;
  message: string;
  file?: string;
  line?: number;
  column?: number;
}
export interface RuleStatus {
  ruleId: string;
  status: "evaluated" | "skipped" | "not-applicable" | "unavailable";
  reason?: string;
}
export interface AnalysisResult {
  schemaVersion: 1;
  zetvikVersion: string;
  generatedAt: string;
  project: Omit<ProjectContext, "rootPath" | "services" | "models">;
  scores: { projectHealth: number | null; securityPosture: number | null; partial: boolean };
  summary: {
    total: number;
    counts: Record<Severity, number>;
    files: number;
    evaluated: number;
    skipped: number;
    notApplicable: number;
    unavailable: number;
  };
  findings: Finding[];
  diagnostics: Diagnostic[];
  rules: RuleStatus[];
}
