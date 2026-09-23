import type { Finding } from "./types.js";
export interface ScoringStrategy {
  score(findings: readonly Finding[]): number;
}
export const scoring: ScoringStrategy = {
  score(findings) {
    const weights = { info: 0, low: 1, medium: 4, high: 12, critical: 30 };
    let active = 0;
    let modernization = 0;
    for (const f of findings) {
      const weight = weights[f.severity] * { low: 0.25, medium: 0.75, high: 1 }[f.confidence];
      if (f.kind === "modernization") modernization += weight * 0.25;
      else active += weight;
    }
    return Math.max(0, Math.round(100 - active - Math.min(10, modernization)));
  },
};
