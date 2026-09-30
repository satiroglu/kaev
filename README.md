# Kaev

Production-oriented health, security, performance, and architecture analysis for SAPUI5, OpenUI5, and SAP Fiori projects.

Kaev identifies the project context first, runs only applicable checks, and turns each finding into a source location, severity, confidence level, evidence basis, and actionable recommendation.

> **Local by design:** Kaev analyzes source code on your machine. It has no telemetry and does not upload project files.

```text
KAEV v0.2.1

sales-app · sapui5 application
UI5 1.120.21 · CLI spec 3.0 · freestyle · javascript · OData v2

Checks

Configuration
  ✓ PASS  Manifest readability · KAEV-CONFIG-001
  ✓ PASS  UI5 configuration availability · KAEV-CONFIG-002

Security
  ✓ PASS  Frontend credential exposure · KAEV-SEC-001
  ✗ ISSUE  Sensitive browser storage · KAEV-SEC-002 · 1 finding(s)
      HIGH · HIGH confidence · webapp/util/Auth.js:41:5

Project Health 88/100 · Security Posture 88/100
1 findings · 19 evaluated · 0 not applicable · 0 skipped · 0 unavailable
Checks: 18 passed · 1 with findings
Severity: 1 high

Top priorities
  KAEV-SEC-002 · Sensitive browser storage
```

## Why Kaev?

- Understands SAPUI5/OpenUI5 context instead of treating every project as generic JavaScript.
- Covers project configuration, UI5 practices, OData, architecture, performance, and frontend security.
- Integrates the official `@ui5/linter` in a restricted child process.
- Produces deterministic terminal, Markdown, JSON, SARIF, JUnit, and GitHub Actions output.
- Groups every check by category and shows passed, failed, suppressed, skipped, and unavailable coverage.
- Supports enterprise quality gates, baselines, expiring suppressions, and monorepos.
- Separates official guidance, derived checks, and heuristics.
- Keeps normal analysis read-only and never overwrites an existing report.

Kaev complements UI5 CLI, UI5 Linter, TypeScript, ESLint, SAP Fiori tools, runtime testing, and professional security review. It does not replace them.

## Contents

- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Understand the result](#understand-the-result)
- [Commands](#commands)
- [Reports and output formats](#reports-and-output-formats)
- [Configuration](#configuration)
- [Baseline and suppressions](#baseline-and-suppressions)
- [CI/CD](#cicd)
- [Monorepos](#monorepos)
- [Rules, scoring, and evidence](#rules-scoring-and-evidence)
- [Privacy and security](#privacy-and-security)
- [Troubleshooting](#troubleshooting)
- [Analysis boundaries](#analysis-boundaries)
- [Development](#development)
- [License](#license)

## Requirements and Node.js Support Policy

- **Officially Supported:** Node.js 22 (`>=22.12.0`) and Node.js 24 LTS.
- **Enterprise Compatibility Support:** Node.js 20.11+ is temporarily supported on a best-effort basis for existing enterprise SAPUI5 environments. Support for Node.js 20 is deprecated and planned for removal in a future major release.
- **Unsupported:** Node.js 18 and earlier fail safely at startup with exit code 2 and a message recommending Node 22 or 24 LTS.
- A SAPUI5/OpenUI5 project directory.

The analyzed project normally contains `ui5.yaml` and an application source directory such as `webapp/`. Kaev does not need to be installed in that project's dependencies. Package installation requires registry access; project analysis runs offline.

## Quick start

Run Kaev without installing it permanently:

```sh
cd path/to/my-ui5-app
npx @satiroglu/kaev@latest
```

Or install the command globally:

```sh
npm install --global @satiroglu/kaev
cd path/to/my-ui5-app
kaev
```

The default command is equivalent to:

```sh
kaev check
```

Common next steps:

```sh
kaev check --verbose             # Show evidence and recommendations
kaev check --category security   # Analyze one category
kaev check --severity high       # Display high and critical findings
kaev report                      # Create a Markdown report
kaev doctor                      # Diagnose project recognition and setup
```

## Understand the result

Every finding includes:

- A stable rule ID such as `KAEV-SEC-002`
- Severity: `info`, `low`, `medium`, `high`, or `critical`
- Confidence: `low`, `medium`, or `high`
- A project-relative file, line, and column when available
- A rule basis, explanation, and recommended action

Terminal and Markdown reports show the full check inventory by category:

- `PASS`: evaluated without a finding
- `ISSUE`: evaluated and produced one or more active findings
- `SUPPRESSED`: findings were accepted by an explicit policy or baseline
- `N/A`: the check does not apply to the detected project context
- `SKIPPED`: the check was deliberately excluded or disabled
- `UNAVAILABLE`: the check could not be completed safely

Severity describes potential impact. Confidence describes how strongly the static evidence supports the finding. A finding is evidence for review, not automatic proof of a defect or vulnerability.

Kaev reports two scores:

- **Project Health:** the weighted condition of all analyzed categories.
- **Security Posture:** the weighted condition of security findings when security was analyzed.

A score can be marked partial when a category was selected, analysis coverage was skipped, a required analyzer was unavailable, or diagnostics prevented complete coverage. A score of 100 is not a security guarantee.

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Analysis completed and no finding reached the configured failure threshold. |
| `1` | Analysis completed and at least one finding reached the failure threshold. |
| `2` | Analysis, configuration, filesystem, or required-analyzer failure. |

The default failure threshold is `high`. Change it without changing the report contents:

```sh
kaev check --fail-on medium
kaev check --fail-on critical
kaev check --fail-on none
```

`--severity` only filters displayed findings. `--fail-on` controls the quality gate.

## Commands

### `kaev` / `kaev check`

Analyze the current project without modifying it:

```sh
kaev
kaev check --verbose
kaev check --quiet
kaev check --category performance
kaev check --severity high
kaev check --fail-on medium
kaev check --no-ui5-lint
```

### `kaev report`

Create a new timestamped report file. The default name is `kaev-report-[package-name]-[local-timestamp].md`:

```sh
kaev report
kaev report --output ./reports/kaev.md
kaev report --category security --output ./reports/security.md
kaev report --format json --output ./reports/kaev.json
kaev report --format sarif --output ./reports/kaev.sarif
kaev report --format junit --output ./reports/kaev.xml
```

The parent directory must already exist. Kaev rejects symbolic-link parent directories and refuses to overwrite an existing file.

For example, a report generated in Istanbul may be named:

```text
kaev-report-sales-app-20260928-182100-125+0300.md
```

Human-readable Markdown shows both the computer's local timestamp and the canonical UTC timestamp. JSON keeps its existing UTC `generatedAt` value for stable machine processing.

### `kaev doctor`

Check Node.js compatibility, project detection, source roots, UI5 metadata, configuration, baseline presence, and UI5 Linter availability:

```sh
kaev doctor
```

### `kaev init`

Create a safe default `.kaevrc.json` in the current project:

```sh
kaev init
```

An existing configuration is never overwritten.

### `kaev baseline`

Record current findings so an existing project can introduce a “no new findings” quality gate:

```sh
kaev baseline
git add .kaev-baseline.json
```

An existing baseline is never overwritten. Delete or rename it deliberately before generating a replacement.

### `kaev explain`

Show a rule's category, severity, basis, rationale, recommendation, and references:

```sh
kaev explain KAEV-SEC-002
```

### `kaev workspace`

Discover and analyze UI5 projects in a monorepo:

```sh
cd path/to/monorepo
kaev workspace
kaev workspace --fail-on high
```

See [Monorepos](#monorepos) for discovery limits.

### Options

| Option | Meaning |
| --- | --- |
| `-v, --verbose` | Show detailed evidence, references, diagnostics, and recommendations. |
| `-q, --quiet` | Show significant findings only. Cannot be combined with `--verbose`. |
| `--category <name>` | Analyze `project`, `config`, `ui5`, `odata`, `architecture`, `performance`, or `security`. |
| `--severity <level>` | Minimum displayed severity; does not change scores or exit status. |
| `--fail-on <level>` | Lowest severity that fails the quality gate, or `none`. |
| `--format <format>` | Select an output format supported by the current command. |
| `--color <mode>` | Use `auto`, `always`, or `never`. |
| `--no-color` | Disable ANSI color. `NO_COLOR` is also honored. |
| `--config <file>` | Use another JSON configuration file from the project root. |
| `--baseline <file>` | Use another baseline file from the project root. |
| `--no-ui5-lint` | Skip the official UI5 Linter integration and report partial coverage. |
| `--debug` | Show sanitized stack traces and diagnostics on unexpected failure (also `KAEV_DEBUG=1`). |
| `-V, --version` | Print the installed version. |
| `-h, --help` | Show command help. |

## Reports and output formats

Kaev separates human-readable reports from machine-readable CI output.

| Format | Command | Intended use |
| --- | --- | --- |
| Terminal | `kaev check` | Interactive local review with automatic color. |
| Markdown | `kaev report` | Detailed, shareable `.md` report. |
| JSON | `kaev check --format json` | Stable machine-readable Kaev schema. |
| SARIF | `kaev check --format sarif` | Code-scanning and security platforms. |
| JUnit XML | `kaev check --format junit` | CI test-report systems, including passed and non-applicable checks. |
| GitHub | `kaev check --format github` | GitHub Actions workflow annotations. |

Examples:

```sh
kaev check --format json > kaev-result.json
kaev check --format sarif > kaev.sarif
kaev check --format junit > kaev-junit.xml
kaev check --format github
```

Machine-readable formats never contain ANSI color codes or progress messages. Operational errors are written to stderr.

Kaev does **not** currently generate PDF directly. Generate a Markdown report first, then convert it with a tool such as Pandoc if a PDF is required.

## Configuration

Kaev automatically loads `.kaevrc.json` from the analyzed project root. CLI options override configuration values.

Create the default file with:

```sh
kaev init
```

Example:

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

| Property | Meaning |
| --- | --- |
| `version` | Configuration schema version. Must be `1`. |
| `category` | Optional single category: `project`, `config`, `ui5`, `odata`, `architecture`, `performance`, or `security`. |
| `severity` | Minimum displayed severity. |
| `failOn` | Quality-gate threshold or `none`. |
| `ui5Lint` | Enable or disable the official UI5 Linter integration. |
| `color` | `auto`, `always`, or `never`. |
| `baseline` | Safe project-root-relative baseline filename. |
| `exclude` | Bounded glob patterns excluded from discovery. |
| `suppressions` | Reviewable rule/file exceptions with a mandatory reason. |

Unknown properties, invalid enum values, unsafe paths, oversized policy lists, and malformed suppressions fail closed with exit code `2`.

## Baseline and suppressions

### Adopt Kaev in an existing project

Review current findings before creating a baseline:

```sh
kaev check --verbose
kaev baseline
git add .kaev-baseline.json
git commit -m "chore: establish Kaev baseline"
```

Future checks show and gate only findings not recorded in that baseline. Fingerprints contain finding identity, not source code.

A baseline does not declare existing findings safe and does not improve their score. It provides an auditable migration path while teams resolve existing debt.

### Suppress an intentional finding

Use `.kaevrc.json` when a specific rule or file pattern is intentionally accepted:

```json
{
  "version": 1,
  "suppressions": [
    {
      "ruleId": "KAEV-PERF-001",
      "file": "webapp/local/**",
      "reason": "Dataset is contractually limited to 20 local records",
      "expires": "2027-03-31"
    }
  ]
}
```

Reasons are mandatory. Expiry dates use `YYYY-MM-DD`; expired suppressions automatically stop matching. Commit policy files so changes receive normal code review.

## CI/CD

Install Kaev as a development dependency for reproducible CI runs:

```sh
npm install --save-dev @satiroglu/kaev
```

Add scripts to the analyzed project's `package.json`:

```json
{
  "scripts": {
    "kaev": "kaev check --fail-on high",
    "kaev:sarif": "kaev check --format sarif"
  }
}
```

### GitHub Actions quality gate

```yaml
name: Kaev

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  analyze:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run kaev
```

### GitHub workflow annotations

```yaml
- name: Run Kaev annotations
  run: npx --no-install kaev check --format github --fail-on high
```

### Save a SARIF artifact

```yaml
- name: Create Kaev SARIF
  run: npx --no-install kaev check --format sarif --fail-on none > kaev.sarif
- uses: actions/upload-artifact@v4
  with:
    name: kaev-sarif
    path: kaev.sarif
```

Use the process exit code—not text parsing—to decide whether a quality gate passed. `--fail-on none` is useful when a later system evaluates the generated artifact.

## Monorepos

`kaev workspace` searches for UI5 projects beneath the current directory and reports each project independently.

Safety limits:

- Maximum discovery depth: four directories
- Maximum projects: 100
- Hidden directories, dependencies, build output, coverage, and symbolic links are excluded
- Each project can provide its own `.kaevrc.json` and baseline

Workspace mode currently renders terminal output. Run `kaev check` inside an individual project when a dedicated JSON, SARIF, JUnit, or Markdown artifact is required.

## Rules, scoring, and evidence

Kaev groups rules into `project`, `config`, `ui5`, `odata`, `architecture`, `performance`, and `security`.

Every native rule declares one of these bases:

- **Official:** directly documented UI5 guidance.
- **Derived:** a static-analysis interpretation of documented behavior.
- **Heuristic:** a Kaev risk pattern that requires project-context review.

Useful references:

- [Rule catalogue](docs/rules.md)
- [Scoring model](docs/scoring.md)
- [Architecture and trust boundary](docs/architecture.md)
- [JSON output contract](docs/json.md)
- [Third-party dependency review](docs/dependency-security.md)

## Privacy and security

- Analysis is local and offline.
- There is no telemetry or source-code upload.
- Source parsers do not execute analyzed JavaScript or TypeScript.
- XML DTDs are rejected.
- Secret-like evidence is redacted and output is bounded.
- Project-relative paths are used; absolute analyzed-project paths are not reported.
- `check` and `doctor` are read-only.
- `report`, `init`, and `baseline` create only explicitly requested files and refuse to overwrite existing files.

### UI5 Linter isolation

The bundled official UI5 Linter runs through its Node API in a restricted child process:

- Executable repository configuration is disabled.
- Network entry points are blocked before the analyzer is imported.
- Filesystem read permissions are constrained.
- Filesystem writes and child-process creation are not granted.
- Execution has a timeout and memory limit.
- External messages are replaced with bounded descriptions.

UI5 Linter compatibility findings are modernization guidance, not automatically defects in the project's current runtime. Use `--no-ui5-lint` only when the integration must be skipped; Kaev will mark coverage partial.

Read the [architecture document](docs/architecture.md) for the complete trust model and the [dependency security notes](docs/dependency-security.md) for reviewed upstream advisories.

## Troubleshooting

| Problem | What to do |
| --- | --- |
| `kaev: command not found` | Use `npx @satiroglu/kaev@latest`, install globally, or add Kaev as a project development dependency. |
| `npx` runs an older release | Include `@latest`, verify with `npx @satiroglu/kaev@latest --version`, and review the local npm cache if needed. |
| Command exits with code `1` | Analysis completed, but a finding reached the failure threshold. Review the report or change `--fail-on` deliberately. |
| Command exits with code `2` | Run `kaev doctor`; inspect configuration, filesystem diagnostics, Node.js compatibility, and analyzer availability. |
| `UI5-LINTER` is unavailable | Run `kaev doctor`, verify the supported Node.js version, and rerun with `--verbose`. Use `--no-ui5-lint` only as an explicit partial-coverage choice. |
| Output has no colors | Colors are automatic only in an interactive terminal. Check `NO_COLOR`, redirection, and `--color` settings. |
| JSON parsing fails | Use `--format json` directly and parse stdout only; diagnostics are written to stderr. |
| Report already exists | Choose a new `--output` filename. Kaev intentionally has no overwrite flag. |
| Report cannot be created | Create the parent directory first and ensure it is not a symbolic link. |
| Baseline has no effect | Confirm the configured filename, run `kaev doctor`, and remember that changed finding identity creates a new fingerprint. |
| A suppression stopped matching | Check its `expires` date, rule ID, and project-relative file glob. |
| Project is not detected | Run from the UI5 project root containing `ui5.yaml` and the configured application source directory. |

## Analysis boundaries

Kaev models application, component, library, theme-library, and module projects; honors configured resource paths; and recognizes common legacy layouts. The official UI5 Linter adapter currently applies to application roots.

Important limitations:

- UI5 runtime, minimum runtime requirement, UI5 configuration specification, and UI5 CLI dependency version are distinct facts.
- OData tracing is local rather than fully interprocedural. It covers known model imports and constructors, manifest-backed `getModel` calls, bounded local aliases, V2 `read` success callbacks and `getProperty`, plus V4 `bindList`/`bindContext` to `requestContexts` flows.
- Fully dynamic URL construction and arbitrary cross-function data flow are not resolved. Static template and concatenation segments are handled only when they can be established safely.
- Stable-ID checks focus on selected `sap.m` controls in flexibility-enabled freestyle applications.
- Dynamic HTML is a review finding, not proof of exploitability.
- Manual OData writes do not prove a CSRF vulnerability.
- Frontend role checks do not prove missing backend authorization.
- Dependency, generated, and test directories are excluded by default.
- Files larger than 1 MiB, symbolic links, binary files, and oversized or deeply nested repositories are excluded with diagnostics.
- There is no persistent cache, autofix, dependency installation, or telemetry.

Kaev does not replace backend authorization tests, integration tests, browser/runtime tests, penetration testing, or professional security review.

## Development

```sh
npm ci --ignore-scripts
npm run typecheck
npm run lint
npm test
npm run build
npm run check
npm run test:pack
```

`npm run check` performs type checking, lint/format verification, tests, and the production build. `npm run test:pack` creates the npm tarball, installs it into a disposable consumer, and exercises the installed CLI against representative fixtures.

CI verifies macOS, Linux, and Windows on supported Node.js versions. See [release verification](docs/release.md) before publishing.

## License

Kaev is proprietary software. **No open-source license is granted.** Downloading or viewing the npm package does not grant permission to use, copy, modify, redistribute, sublicense, sell, host, or create derivative works. Use requires a separate written agreement with the copyright holder.

See [LICENSE](LICENSE) for the controlling terms. Public npm publication makes package contents downloadable and inspectable; a proprietary license restricts legal rights but does not technically hide those contents. Use a private package or authenticated registry when downloads must be restricted to approved users.

## Developer and contact

Kaev is developed by [Ahmet Ertürk (@aesatiroglu)](https://x.com/aesatiroglu). Questions, suggestions, and issue reports are welcome via X.

## Independence and trademarks

Kaev is an independent developer tool. It is not affiliated with, sponsored by, or endorsed by SAP SE.

SAP, SAPUI5, SAP Fiori, and other SAP product names are trademarks or registered trademarks of SAP SE or its affiliates in Germany and other countries. Other names belong to their respective owners.
