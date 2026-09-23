# Architecture and trust boundary

The dependency flow is CLI → application orchestration → discovery/workspace/context → rule engine → normalized findings → processing/scoring → reporters.

`src/core` owns the domain contracts, applicability, references, deterministic finding processing and score strategy. `src/analysis` owns parsed source and local AST evidence. `src/detectors` builds a project fingerprint from that workspace. Rules receive no filesystem or CLI interface. Reporters consume the analysis result and never inspect source. `src/i18n/en.ts` is the initial shared-message boundary; rule metadata is centralized through the rule definition factory, so a future translation catalogue can use stable IDs without changing machine keys.

To add a rule, implement the Rule contract, register it in the application rule list, and add positive and negative examples. Explicit applicability supports framework, project type, app type, language, OData, backend, deployment, runtime version and CLI specification version. Upper version limits are exclusive; unknown versions do not satisfy version constraints. Mixed OData/language projects satisfy either declared version/language, while individual rules must still establish local provenance.

Discovery accepts only bounded text files, skips symlinks and known non-application directories, and retains project-relative paths. Discovery limits are 1 MiB per file, 50 MiB of source per execution, 30,000 entries and depth 32. JSON, YAML, XML and JS/TS are parsed once per execution. YAML aliases are bounded; XML DTDs are rejected. Parse errors omit source snippets. Broken files produce diagnostics while other files remain analyzable.

The official linter is an explicit adapter. It receives a minimal generated configuration object, `noConfig: true`, `fix: false`, and an allowlist derived from safe discovery. Repository scripts, executable configs, hooks and custom UI5 tasks are not loaded. The installed Node API runs in a child process with Node filesystem permissions granting read access only to the installed package and project, no write/child-process permissions, a 512 MiB heap limit and a 30-second timeout. Worker environment variables are restricted. Network entry points are disabled before loading the analyzer. No registry/version-notifier CLI is invoked.

The Node permission model and offline guard are defense in depth for a trusted, pinned third-party analyzer, not a general operating-system sandbox for arbitrary hostile JavaScript. The scanner assumes a repository is not being concurrently replaced by a hostile process. Static source remains untrusted input. The adapter can fail closed and reports unavailability rather than quietly omitting coverage.

Project source is never copied to a persistent cache. `create-report.ts` is the sole application file-writing boundary. It requires an explicit report command, an allowed extension, existing non-symlink parent directories and exclusive creation with mode 0600. It cannot overwrite a source file or existing report. Failures use typed, source-free errors.

Custom findings do not include raw source snippets. Credential evidence is a fixed redaction marker. External message bodies are not passed through. Central redaction strips terminal control sequences and known credential representations before reporting. Markdown escapes user-controlled strings. JSON schema keys, enums and rule IDs are language-independent.

Finding precedence, deduplication and sorting are centralized. Future suppression and baselines belong here, before scoring, not in individual rules. Source origin and stable location/identity fields support future SARIF and richer ownership. The single-project orchestration can be called once per workspace project without changing the rule engine. Commercial policy, if ever added, belongs outside rules.

Runtime dependencies are deliberate: Commander (CLI validation), TypeScript (JS/TS AST), jsonc-parser (strict JSON parsing and locations), YAML, saxes (namespace-aware XML), semver (version semantics), and the official UI5 Linter. Biome owns both linting and formatting; Vitest owns tests. There is no second lint/format stack.
