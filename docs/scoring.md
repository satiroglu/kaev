# v0.1 score contract

Scores are Kaev summaries, not SAP-certified scores. Start at 100 and subtract finding penalties. Severity weights are info 0, low 1, medium 4, high 12 and critical 30. Confidence multipliers are low 0.25, medium 0.75 and high 1. Round the final score to the nearest integer and clamp to 0–100.

Modernization findings receive 25% of their normal weight; their combined penalty is capped at 10. Active security/configuration defects are not capped this way. Duplicate findings and lower-priority findings at the same source location are removed before scoring. No passing-rule count is included in the formula.

Project Health uses all evaluated findings. Security Posture uses only security findings. It is null when security was not analyzed. Unrecognized projects receive null scores. Skipped/unavailable checks, discovery diagnostics and category-only analysis mark scores partial; they never create passing points. Partial 100 means no weighted findings in the analyzed subset, not full project health.

Display filters do not affect scoring or exit status. These weights and semantics are versioned with Kaev; changing them requires release notes. Baseline and organization thresholds are future capabilities.
