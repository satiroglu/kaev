# JSON contract — schemaVersion 1

`kaev check --format json` emits one UTF-8 JSON object and a newline, with no decorative stdout. Top-level keys:

| Key | Meaning |
| --- | --- |
| schemaVersion | Integer 1; breaking format changes require a new version |
| kaevVersion | Analyzer package version |
| generatedAt | ISO timestamp; the only intentionally varying metadata |
| project | Project-relative fingerprint; absolute root and service URLs are omitted |
| scores | Project Health, Security Posture (nullable), and partial-coverage flag |
| summary | Finding severity counts, file count and rule-status counts |
| findings | Deterministically ordered normalized findings |
| diagnostics | Source-free parsing/discovery messages |
| rules | Evaluated, skipped, not-applicable and unavailable rule statuses |
| display | Applied minimum severity and shown/total finding counts; summary and scores remain unfiltered |

Findings have ruleId, category, kind, severity, confidence, title, message, basis, referenceIds, origin, whyItMatters and recommendation. File, line, column and bounded evidence are optional. Locations use project-relative POSIX paths and one-based line/column coordinates. Findings sort by descending severity, category, file, line, rule ID and column. Rule IDs and machine enums are stable public identifiers.

Core interfaces are exported from the package. Consumers should tolerate additional fields and new rule IDs. JSON remains the native Kaev contract. Use `--format sarif`, `--format junit`, or `--format github` for standard CI integrations without embedding those formats in rule implementations.
