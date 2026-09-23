# Kaev

Local SAPUI5, OpenUI5 and SAP Fiori project health, security and architecture analysis.

Kaev identifies the project context before applying checks. Findings include stable rule IDs, source locations, severity, confidence, an explicit rule basis, and actionable recommendations. It complements UI5 CLI, UI5 Linter, TypeScript, ESLint, SAP Fiori tools and runtime testing.

**Local analysis. No telemetry. No source-code upload.**

## Installation

Requires Node.js 22.9 or newer. After this package is published:

```sh
npx @satiroglu/kaev
npm install --global @satiroglu/kaev
```

For the local v0.1 package:

```sh
npm ci --ignore-scripts
npm run build
npm pack
npm install --global ./satiroglu-kaev-0.1.0.tgz
```

Run from the root of an individual UI5 project. Kaev does not need to be installed inside that project. Installation may download dependencies; analysis itself runs offline.

## Usage

```sh
kaev                              # equivalent to kaev check
kaev check --verbose
kaev check --quiet
kaev check --category security
kaev check --severity high
kaev check --format json
kaev check --no-ui5-lint
kaev doctor
kaev report
kaev report --format json --output ./reports/kaev.json
```

`check`, the default command, and `doctor` never write to the project. `report` creates only its requested report, using exclusive creation: existing files are never overwritten. Its default name is `kaev-report-[package-name].md`. The parent directory must already exist; symlink parent directories are rejected. Absolute output paths explicitly select a destination outside the project.

JSON stdout contains only JSON. Errors go to stderr. Reports are UTF-8; report paths are printed to stderr. Output is readable without color, including with `NO_COLOR` or redirected output.

```text
KAEV v0.1.0

sales-app · sapui5 application
UI5 1.120.21 · CLI spec 3.0 · freestyle · javascript · OData v2

HIGH · HIGH confidence · Sensitive browser storage
  webapp/util/Auth.js:41:5 · KAEV-SEC-002

Project Health 88/100 · Security Posture 88/100
1 findings · 19 evaluated · 0 not applicable · 0 skipped · 0 unavailable
```

Exit codes: `0` execution succeeded with no high/critical findings; `1` high/critical findings exist; `2` analysis/configuration/runtime failure or an unavailable analyzer. A display severity filter does not change scores or exit status. Category selection narrows analysis and marks the score partial. Unknown projects receive an informational finding and no numerical scores. Diagnostics and skipped/unavailable rule coverage are never treated as successful checks.

## Rules and evidence

Categories: `project`, `config`, `ui5`, `odata`, `architecture`, `performance`, `security`.

- **Official:** directly documented UI5 guidance, such as stable IDs for flexibility.
- **Derived:** a static-analysis interpretation of documented behavior, such as local processing of OData collections.
- **Heuristic:** a Kaev risk pattern, such as credential storage or unusually large binding limits.

Kaev does not invent SAP requirements. Severity describes potential impact; confidence describes detection certainty. Intentional small local datasets and manual requests can be legitimate. Review findings in their application context.

See [rule catalogue](docs/rules.md), [scoring](docs/scoring.md), [architecture and trust boundary](docs/architecture.md), [JSON contract](docs/json.md), and [third-party dependency review](docs/dependency-security.md).

The official `@ui5/linter` is bundled and called through its Node API, with executable repository configuration disabled. Its rule identity and location are preserved. External message bodies are replaced with bounded descriptions to avoid echoing arbitrary source values. Its modern UI5 compatibility findings are reported as modernization, not automatically as defects in the current runtime. Their health penalty is capped.

## Scope and limitations

v0.1 primarily analyzes single applications. It models application, component, library, theme-library and module types, honors configured resource paths, and recognizes common legacy layouts. The official adapter currently supports application roots; other types retain contextual output and applicable custom checks. Workspace-wide aggregation is not implemented.

UI5 runtime, minimum runtime requirement, UI5 configuration specification and UI5 CLI dependency version/range are separate concepts. A dependency range is not an observed installed version. Unknown evidence remains unknown.

OData origin tracing is deliberately local: known model imports/constructors and manifest-backed `getModel` calls, direct local aliases, V2 `read` success callbacks and V2 `getProperty`. V4 collection filtering/sorting tracing, interprocedural analysis and dynamic URL construction are not implemented. Rules do not flag arbitrary array operations. Large size-limit and loop-refresh checks require an identified OData model.

Stable-ID checks focus on selected `sap.m` controls in flexibility-enabled freestyle applications. Direct DOM reads alone are not reported. Dynamic HTML is a review finding, not proof of exploitability. Manual OData writes do not establish a CSRF vulnerability. Frontend role checks never prove that backend authorization is missing.

Dependency, generated and test directories are excluded by default. Files above 1 MiB, symlinks, binary files and oversized/deep repositories are excluded with diagnostics. Limits and exclusions can make analysis partial. Parsers do not execute source; XML DTDs are rejected. There is no persistent cache, user configuration execution, autofix, dependency installation, telemetry, baseline or suppression UX during analysis.

Kaev performs automated static analysis that can help identify security, maintainability, performance, architecture, and SAPUI5/OData risks. It does not replace backend authorization testing, runtime testing, penetration testing, or professional security review. A score of 100 is not a security guarantee.

## Development

```sh
npm ci --ignore-scripts
npm run typecheck
npm run lint
npm test
npm run build
npm run check                     # non-mutating source verification
npm run format                    # explicit formatting changes
npm pack
npm run test:pack                 # installs the tarball in a disposable consumer
```

Tests include positive/negative rule examples, project fixtures, malformed inputs, redaction, read-only behavior, official analyzer integration, CLI behavior and report output safety. CI is configured for macOS, Linux and Windows; local verification does not establish that remote CI has passed. See [release verification](docs/release.md) for packed-artifact checks. The pinned official linter has documented transitive advisories; review them before distribution.

## Independence

Kaev is an independent developer tool and is not affiliated with, sponsored by, or endorsed by SAP SE.

SAP, SAPUI5, SAP Fiori and other SAP product names are trademarks or registered trademarks of SAP SE or its affiliates in Germany and other countries. Other names belong to their respective owners.
