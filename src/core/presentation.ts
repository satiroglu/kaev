import { type AnalysisResult, type Finding, type Severity, severities } from "./types.js";
export interface DisplayOptions {
  verbose?: boolean;
  quiet?: boolean;
  severity?: Severity;
  color?: boolean;
}
export function visibleFindings(result: AnalysisResult, options: DisplayOptions): Finding[] {
  const minimum = options.severity ?? (options.quiet ? "high" : "info");
  return result.findings.filter(
    (f) => severities.indexOf(f.severity) >= severities.indexOf(minimum),
  );
}
