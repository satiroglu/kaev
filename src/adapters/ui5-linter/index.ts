import { fork } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LintResult } from "@ui5/linter";
import type { RuleContext } from "../../core/rules.js";
import type { Finding, RuleStatus } from "../../core/types.js";

export async function lintUi5(
  c: RuleContext,
): Promise<{ findings: Finding[]; status: RuleStatus }> {
  const unavailable = (reason: string) =>
    ({
      findings: [],
      status: {
        ruleId: "UI5-LINTER",
        title: "Official UI5 Linter",
        category: "ui5",
        status: "unavailable",
        reason: `UI5 Linter could not safely analyze this project (${reason}).`,
      },
    }) as const;
  if (
    !c.project.detected ||
    !c.project.sourceRoots.length ||
    !["application", "unknown"].includes(c.project.projectType)
  )
    return {
      findings: [],
      status: {
        ruleId: "UI5-LINTER",
        title: "Official UI5 Linter",
        category: "ui5",
        status: "not-applicable",
        reason: "v0.1 adapter supports individual application roots.",
      },
    };
  if (!c.project.files["manifest.json"])
    return {
      findings: [],
      status: {
        ruleId: "UI5-LINTER",
        title: "Official UI5 Linter",
        category: "ui5",
        status: "not-applicable",
        reason:
          "Official UI5 Linter requires a project manifest; legacy custom checks remain available.",
      },
    };
  const root = c.project.sourceRoots[0];
  const allowed = c.workspace.files
    .filter((f) => root === "." || f.path.startsWith(`${root}/`))
    .filter((f) => !c.workspace.diagnostics.some((d) => d.file === f.path && d.code === "parse"));
  if (!allowed.length)
    return {
      findings: [],
      status: {
        ruleId: "UI5-LINTER",
        title: "Official UI5 Linter",
        category: "ui5",
        status: "not-applicable",
        reason: "No safe application sources.",
      },
    };
  const escapePattern = (p: string) => p.replace(/[?*[\]{}()!+@]/g, "[$&]");
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const dependencyRoot = path.resolve(
    path.dirname(createRequire(import.meta.url).resolve("@ui5/linter/package.json")),
    "../..",
  );
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  // Node 24 removed the experimental spelling after promoting the permission model.
  const permissionFlag = nodeMajor >= 24 ? "--permission" : "--experimental-permission";
  return new Promise((resolve) => {
    const child = fork(new URL("./worker.js", import.meta.url), [], {
      execArgv: [
        permissionFlag,
        `--allow-fs-read=${packageRoot}`,
        `--allow-fs-read=${dependencyRoot}`,
        `--allow-fs-read=${c.project.rootPath}`,
        "--max-old-space-size=512",
        "--disable-proto=throw",
      ],
      env: {
        NODE_OPTIONS: "",
        UI5_LOG_LVL: "silent",
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    let finished = false;
    let exitTimer: ReturnType<typeof setTimeout> | undefined;
    const done = (value: { findings: readonly Finding[]; status: RuleStatus }) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (exitTimer) clearTimeout(exitTimer);
      child.kill();
      resolve({ findings: [...value.findings], status: value.status });
    };
    const timer = setTimeout(() => done(unavailable("timeout")), 30000);
    child.on("error", () => done(unavailable("worker-start-failed")));
    // IPC messages and process exit are separate event streams. A short grace period
    // prevents a valid queued result from being lost when runners deliver exit first.
    child.on("exit", (code, signal) => {
      exitTimer = setTimeout(
        () =>
          done(unavailable(signal ? "worker-terminated" : `worker-exited-${code ?? "unknown"}`)),
        100,
      );
    });
    child.on("message", (message: { ok: boolean; results?: LintResult[] }) => {
      if (!message.ok || !Array.isArray(message.results)) {
        done(unavailable("analyzer-rejected-project"));
        return;
      }
      if (
        message.results.some(
          (result) => result.fatalErrorCount > 0 || result.messages.some((m) => m.fatal),
        )
      ) {
        done(unavailable("analyzer-fatal-result"));
        return;
      }
      const findings: Finding[] = [];
      for (const result of message.results) {
        const file = path.isAbsolute(result.filePath)
          ? path.relative(c.project.rootPath, result.filePath).split(path.sep).join("/")
          : result.filePath;
        if (!allowed.some((f) => f.path === file)) continue;
        for (const m of result.messages)
          findings.push({
            ruleId: `UI5LINT/${m.ruleId}`,
            title: `UI5 compatibility: ${m.ruleId}`,
            message:
              "Official UI5 Linter reported a compatibility concern at this location. Review it against the target runtime.",
            category: "ui5",
            kind: "modernization",
            severity: m.severity === 2 ? "medium" : "low",
            confidence: "high",
            file,
            line: m.line === undefined ? undefined : Math.max(1, m.line),
            column: m.column === undefined ? undefined : Math.max(1, m.column),
            basis: "official",
            referenceIds: ["linter"],
            origin: "application",
            whyItMatters:
              "UI5 Linter targets modern UI5 compatibility; this is not automatically a defect in the current runtime.",
            recommendation:
              "Review this official rule using UI5 Linter and plan changes for the intended UI5 runtime.",
          });
      }
      done({
        findings,
        status: {
          ruleId: "UI5-LINTER",
          title: "Official UI5 Linter",
          category: "ui5",
          status: "evaluated",
          findingCount: findings.length,
        },
      });
    });
    child.send({
      rootDir: c.project.rootPath,
      noConfig: true,
      fix: false,
      ui5Config: {
        specVersion: "3.0",
        metadata: { name: "kaev-analysis" },
        type: "application",
        resources: { configuration: { paths: { webapp: root } } },
      },
      ignorePatterns: ["**/*", ...allowed.map((f) => `!${escapePattern(f.path)}`)],
    });
  });
}
