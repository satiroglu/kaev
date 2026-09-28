# Kaev

Production-oriented health, security, performance, and architecture analysis for SAPUI5, OpenUI5, and SAP Fiori projects.

Kaev first identifies the project context, then applies only relevant checks. Every finding has a stable rule ID, source location, severity, confidence, rule basis, evidence, and an actionable recommendation. It complements UI5 CLI, UI5 Linter, TypeScript, ESLint, SAP Fiori tools, runtime testing, and professional security review.

> **Local by design:** source code is analyzed on the local machine. Kaev has no telemetry and does not upload project files.

## Highlights

- Detects SAPUI5/OpenUI5 project type, application style, language, UI5 versions, OData usage, source roots, and common deployment metadata.
- Covers project configuration, UI5 practices, OData usage, architecture, performance, and frontend security.
- Integrates the official `@ui5/linter` through a restricted child process.
- Produces deterministic terminal, JSON, and Markdown output suitable for local development and CI.
- Distinguishes official guidance, derived checks, and heuristics instead of presenting every finding as an SAP requirement.
- Uses read-only analysis. Only `kaev report` writes a new report file, and it never overwrites an existing file.

## Requirements

- Node.js `22.9.0` or newer
- A single SAPUI5/OpenUI5 project directory to analyze

Kaev does not need to be added to the analyzed project's dependencies. Package installation requires registry access; analysis itself runs offline.

## Installation

Run without a permanent installation:

```sh
npx @satiroglu/kaev
```

Or install the CLI globally:

```sh
npm install --global @satiroglu/kaev
kaev --version
```

Installing the package does not grant a license to use it. See [License](#license).

## Quick start

Change to the root of one UI5 project and run:

```sh
cd path/to/my-ui5-app
kaev
```

The default command is equivalent to `kaev check`.

Typical CI-oriented usage:

```sh
kaev check --format json > kaev-result.json
```

Use the exit code—not formatted output—to decide whether the quality gate passed.

## Commands

### `kaev` / `kaev check`

Analyzes the current project and prints findings. It does not change project files.

```sh
kaev check
kaev check --verbose
kaev check --quiet
kaev check --category security
kaev check --severity high
kaev check --format json
kaev check --format sarif > kaev.sarif
kaev check --format junit > kaev-junit.xml
kaev check --format github
kaev check --fail-on medium
kaev check --no-color
kaev check --no-ui5-lint
```

### `kaev report`

Creates a Markdown or JSON report. By default, the report is named `kaev-report-[package-name].md`.

```sh
kaev report
kaev report --format json --output ./reports/kaev.json
kaev report --category security --output ./reports/security.md
kaev report --format sarif --output ./reports/kaev.sarif
kaev report --format junit --output ./reports/kaev.xml
```

The output file must not already exist and its parent directory must exist. Kaev rejects symlink parent directories and never overwrites an existing report. An absolute path explicitly selects a location outside the analyzed project.

### `kaev doctor`

Diagnoses project recognition, environment compatibility, and analyzer availability without modifying the project.

```sh
kaev doctor
```

### `kaev init`, `kaev baseline`, and `kaev explain`

Create project configuration, accept current findings as a reviewable baseline, or inspect a rule:

```sh
kaev init
kaev baseline
kaev explain KAEV-SEC-002
```

Both writing commands refuse to overwrite existing files. Baseline fingerprints contain finding identity, not source code. Review and commit generated policy files so changes remain auditable.

### `kaev workspace`

Analyze UI5 projects in a monorepo. Discovery is bounded to four directory levels and 100 projects and excludes dependencies, build output, hidden directories, and symbolic links.

```sh
cd path/to/monorepo
kaev workspace --fail-on high
```

### Global options

| Option | Meaning |
| --- | --- |
| `-v, --verbose` | Show detailed analysis information. |
| `-q, --quiet` | Show significant findings only. |
| `--category <name>` | Analyze one category: `project`, `config`, `ui5`, `odata`, `architecture`, `performance`, or `security`. |
| `--severity <level>` | Set the minimum displayed severity: `info`, `low`, `medium`, `high`, or `critical`. Scores and exit status do not change. |
| `--fail-on <level>` | Fail at `info`, `low`, `medium`, `high`, or `critical`; use `none` to report only. |
| `--format <format>` | Checks support `terminal`, `json`, `sarif`, `junit`, and `github`; reports support `markdown`, `json`, `sarif`, and `junit`. |
| `--color <mode>` | Select `auto`, `always`, or `never`. |
| `--no-color` | Disable ANSI colors. The `NO_COLOR` environment variable is also honored. |
| `--config <file>` | Load an alternative JSON configuration from the project root. |
| `--baseline <file>` | Use an alternative baseline file from the project root. |
| `--no-ui5-lint` | Skip official UI5 Linter integration. The skipped coverage remains visible. |
| `-V, --version` | Print the installed Kaev version. |
| `-h, --help` | Show command help. |

## Output and exit codes

Terminal findings remain readable without color, with `NO_COLOR`, and when redirected. JSON mode writes only the JSON document to stdout; operational errors go to stderr.

```text
KAEV v0.2.0

sales-app · sapui5 application
UI5 1.120.21 · CLI spec 3.0 · freestyle · javascript · OData v2

HIGH · HIGH confidence · Sensitive browser storage
  webapp/util/Auth.js:41:5 · KAEV-SEC-002

Project Health 88/100 · Security Posture 88/100
1 findings · 19 evaluated · 0 not applicable · 0 skipped · 0 unavailable
```

| Code | Meaning |
| --- | --- |
| `0` | Analysis completed and no high or critical findings were detected. |
| `1` | Analysis completed with one or more high or critical findings. |
| `2` | Analysis, configuration, or runtime failure; or a required analyzer was unavailable. |

A severity filter only changes what is displayed. It never hides a failure from the score or exit status. Selecting a category narrows analysis and marks the score as partial. Unknown projects receive an informational finding and no numerical score. Skipped or unavailable coverage is reported explicitly.

## Project policy and configuration

Kaev loads `.kaevrc.json` from the analyzed project root. CLI options override configuration. Unknown keys, invalid values, unsafe paths, and malformed suppressions fail closed with exit code `2`.

```json
{
  "version": 1,
  "severity": "info",
  "failOn": "high",
  "ui5Lint": true,
  "color": "auto",
  "baseline": ".kaev-baseline.json",
  "exclude": ["webapp/generated/**"],
  "suppressions": [
    {
      "ruleId": "KAEV-PERF-001",
      "file": "webapp/local/**",
      "reason": "Approved small offline dataset; reviewed in ADR-014",
      "expires": "2027-03-31"
    }
  ]
}
```

Suppression reasons are mandatory and expiry dates use `YYYY-MM-DD`. Expired suppressions stop matching automatically. Baselines and suppressions affect displayed findings and the quality gate but never rewrite source files. Scores remain the analyzer's unmodified assessment.

SARIF integrates with code-scanning systems, JUnit represents high and critical findings as failed cases, and GitHub format emits workflow annotations. Machine-readable formats never contain colors or progress messages.

## Rules and evidence

Kaev groups checks into `project`, `config`, `ui5`, `odata`, `architecture`, `performance`, and `security`.

Each rule declares its basis:

- **Official:** directly documented UI5 guidance, such as stable IDs for flexibility.
- **Derived:** a static-analysis interpretation of documented behavior, such as local processing of OData collections.
- **Heuristic:** a Kaev risk pattern, such as credential storage or unusually large binding limits.

Severity represents potential impact; confidence represents detection certainty. A finding is evidence for review, not proof of a defect or vulnerability. Intentional small local datasets, manual requests, and project-specific patterns can be legitimate.

Detailed references:

- [Rule catalogue](docs/rules.md)
- [Scoring model](docs/scoring.md)
- [Architecture and trust boundary](docs/architecture.md)
- [JSON output contract](docs/json.md)
- [Third-party dependency review](docs/dependency-security.md)

## UI5 Linter integration

The official `@ui5/linter` is bundled and invoked through its Node API in a restricted child process. Executable repository configuration is disabled, network access is blocked, filesystem permissions are constrained, and execution has a timeout. Original rule identity and locations are preserved. External message bodies are replaced with bounded descriptions so arbitrary project values are not echoed.

Modern UI5 compatibility findings are classified as modernization guidance rather than automatically treated as defects in the current runtime. Their health-score impact is capped. Use `--no-ui5-lint` when the official analyzer must be skipped; Kaev will report the resulting coverage gap.

## Analysis boundaries

Version 0.1 models application, component, library, theme-library, and module projects; honors configured resource paths; and recognizes common legacy layouts. `kaev workspace` runs bounded analysis across monorepo project roots. The official UI5 Linter adapter currently supports application roots; other project types still receive contextual output and applicable Kaev checks.

Important limitations:

- UI5 runtime, minimum runtime requirement, UI5 configuration specification, and UI5 CLI dependency version/range are separate facts. A dependency range is not treated as an installed version.
- OData tracing is intentionally local. It covers known model imports and constructors, manifest-backed `getModel` calls, direct local aliases, V2 `read` success callbacks, and V2 `getProperty` usage.
- V4 collection filtering/sorting tracing, interprocedural analysis, and dynamic URL construction are not implemented.
- Stable-ID checks focus on selected `sap.m` controls in flexibility-enabled freestyle applications.
- Dynamic HTML is a review finding, not proof of exploitability. Manual OData writes do not prove a CSRF vulnerability. Frontend role checks do not prove missing backend authorization.
- Dependency, generated, and test directories are excluded by default. Files larger than 1 MiB, symlinks, binary files, and oversized or deeply nested repositories are excluded with diagnostics.
- Parsers do not execute application source, and XML DTDs are rejected.
- There is no persistent cache, autofix, dependency installation, or telemetry. Baselines and suppressions are explicit, local, reviewable policy files.

Kaev does not replace backend authorization tests, integration tests, browser/runtime tests, penetration testing, or professional security review. A score of 100 is not a security guarantee.

## Privacy and safety

- Project analysis is local and offline.
- There is no telemetry or source-code upload.
- Source parsers do not execute analyzed JavaScript or TypeScript.
- Secret-like evidence is redacted and output is bounded.
- `check` and `doctor` are read-only.
- `report` creates one explicitly requested file and refuses to overwrite it.

Review [the architecture document](docs/architecture.md) for the full trust model.

## Development and verification

```sh
npm ci --ignore-scripts
npm run typecheck
npm run lint
npm test
npm run build
npm run check
npm run test:pack
```

`npm run check` verifies types, formatting/lint rules, tests, and the production build. `npm run test:pack` packs Kaev, installs the tarball into a disposable consumer, and exercises the installed CLI against clean, insecure, malformed, legacy, and custom-source-root fixtures.

CI is configured for macOS, Linux, and Windows. The pinned official linter currently has documented transitive advisories; review [the dependency security notes](docs/dependency-security.md) before distribution. See [release verification](docs/release.md) for the complete packed-artifact checklist.

## License

Kaev is proprietary software. **No open-source license is granted.** Downloading or viewing the npm package does not grant permission to use, copy, modify, redistribute, sublicense, sell, host, or create derivative works from it. Use requires a separate written agreement with the copyright holder.

See the [LICENSE](LICENSE) file for the controlling terms. If you intend to offer paid or approved access, provide customers with a separate commercial license agreement before they use the CLI.

Publishing a package publicly on npm makes its distributed files downloadable and inspectable. A proprietary license restricts legal rights; it does not technically hide the package contents. Use a private npm package or another authenticated registry if only approved users should be able to download it.

## Developer and contact

Kaev is developed by [Ahmet Ertürk (@aesatiroglu)](https://x.com/aesatiroglu). Questions, suggestions, and issue reports are welcome via X.

## Independence and trademarks

Kaev is an independent developer tool. It is not affiliated with, sponsored by, or endorsed by SAP SE.

SAP, SAPUI5, SAP Fiori, and other SAP product names are trademarks or registered trademarks of SAP SE or its affiliates in Germany and other countries. Other names belong to their respective owners.
