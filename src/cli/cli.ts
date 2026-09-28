#!/usr/bin/env node
import type { Dirent } from "node:fs";
import { open, readdir } from "node:fs/promises";
import path from "node:path";
import { Command, CommanderError, Option } from "commander";
import { analyzeProject } from "../application/analyze-project.js";
import { createReport } from "../application/create-report.js";
import { runDoctor } from "../application/run-doctor.js";
import {
  CONFIG_FILE,
  defaultConfig,
  type KaevConfig,
  loadConfig,
  safeConfigPath,
} from "../config/config.js";
import { applyPolicy, createBaseline } from "../core/policy.js";
import {
  type AnalysisResult,
  type Category,
  categories,
  type Severity,
  severities,
} from "../core/types.js";
import { messages } from "../i18n/en.js";
import { github, json, junit, markdown, sarif, terminal } from "../reporters/index.js";
import { projectRules } from "../rules/project.js";
import { sourceRules } from "../rules/source.js";
import { EXIT, KaevError, VERSION } from "../shared/errors.js";

type Format = "terminal" | "json" | "markdown" | "sarif" | "junit" | "github";
interface Options {
  verbose?: boolean;
  quiet?: boolean;
  category?: Category;
  severity?: Severity;
  failOn?: Severity | "none";
  format?: Format;
  ui5Lint?: boolean;
  output?: string;
  color?: "auto" | "always" | "never" | false;
  config?: string;
  baseline?: string;
}

const program = new Command()
  .name("kaev")
  .description(`Kaev — ${messages.tagline}`)
  .version(VERSION)
  .exitOverride();

function options(command: Command, report = false): Command {
  return command
    .option("-v, --verbose", "Show detailed analysis information")
    .option("-q, --quiet", "Show significant findings only")
    .addOption(new Option("--category <category>", "Analyze one category").choices([...categories]))
    .addOption(
      new Option(
        "--severity <level>",
        "Minimum displayed severity (does not change scores)",
      ).choices([...severities]),
    )
    .addOption(
      new Option("--fail-on <level>", "Lowest severity that fails the quality gate").choices([
        ...severities,
        "none",
      ]),
    )
    .addOption(
      new Option("--format <format>", "Output format")
        .choices(
          report
            ? ["markdown", "json", "sarif", "junit"]
            : ["terminal", "json", "sarif", "junit", "github"],
        )
        .default(report ? "markdown" : "terminal"),
    )
    .addOption(
      new Option("--color <mode>", "Color output: auto, always, or never").choices([
        "auto",
        "always",
        "never",
      ]),
    )
    .option("--no-color", "Disable color output")
    .option("--config <file>", `Use a project-root config file (default: ${CONFIG_FILE})`)
    .option("--baseline <file>", "Use an explicit baseline file")
    .option("--no-ui5-lint", "Skip official UI5 Linter integration");
}

function withCounts(result: AnalysisResult, findings: AnalysisResult["findings"]): AnalysisResult {
  const counts = Object.fromEntries(
    severities.map((severity) => [
      severity,
      findings.filter((finding) => finding.severity === severity).length,
    ]),
  ) as AnalysisResult["summary"]["counts"];
  return { ...result, findings, summary: { ...result.summary, total: findings.length, counts } };
}

function render(result: AnalysisResult, format: Format, options: Options, color: boolean): string {
  const display = {
    verbose: options.verbose,
    quiet: options.quiet,
    severity: options.severity,
    color,
  };
  if (format === "json") return json(result, display);
  if (format === "markdown") return markdown(result);
  if (format === "sarif") return sarif(result);
  if (format === "junit") return junit(result);
  if (format === "github") return github(result);
  return terminal(result, display);
}

function useColor(mode: Options["color"]): boolean {
  if (mode === false || mode === "never" || "NO_COLOR" in process.env) return false;
  if (mode === "always") return true;
  return !!process.stdout.isTTY;
}

function gateFailed(result: AnalysisResult, threshold: Severity | "none"): boolean {
  if (threshold === "none") return false;
  const minimum = severities.indexOf(threshold);
  return result.findings.some((finding) => severities.indexOf(finding.severity) >= minimum);
}

async function resolved(
  root: string,
  cli: Options,
): Promise<{ options: Options; config: KaevConfig }> {
  const file = await loadConfig(root, cli.config);
  const config = { ...defaultConfig, ...file };
  return {
    config,
    options: {
      ...cli,
      category: cli.category ?? config.category,
      severity: cli.severity ?? config.severity,
      failOn: cli.failOn ?? config.failOn,
      ui5Lint: cli.ui5Lint ?? config.ui5Lint,
      color: cli.color ?? config.color,
      baseline: cli.baseline ?? config.baseline,
    },
  };
}

async function check(cli: Options, report = false): Promise<void> {
  const root = process.cwd();
  const { options: selected, config } = await resolved(root, cli);
  if (selected.quiet && selected.verbose)
    throw new KaevError("configuration", "--quiet and --verbose cannot be combined.");
  const interactive = selected.format === "terminal" && !!process.stderr.isTTY;
  const progress = interactive
    ? (message: string) => process.stderr.write(`\r\x1b[2K${message}…`)
    : undefined;
  const result = await analyzeProject(root, {
    category: selected.category,
    ui5Lint: selected.ui5Lint,
    exclude: config.exclude,
    onProgress: progress,
  });
  if (interactive) process.stderr.write("\r\x1b[2K");
  const policy = await applyPolicy(result.findings, root, {
    ...config,
    baseline: selected.baseline,
  });
  const visible = withCounts(result, policy.active);
  if (report) {
    const format = (selected.format ?? "markdown") as "markdown" | "json" | "sarif" | "junit";
    const file = await createReport(visible, root, format, selected.output);
    process.stderr.write(`Report created: ${file}\n`);
  } else {
    process.stdout.write(
      render(visible, selected.format ?? "terminal", selected, useColor(selected.color)),
    );
    if (policy.suppressed.length && selected.format === "terminal")
      process.stderr.write(
        `${policy.suppressed.length} finding(s) suppressed by policy/baseline.\n`,
      );
  }
  process.exitCode =
    result.summary.unavailable ||
    result.diagnostics.some((d) => ["parse", "filesystem", "configuration"].includes(d.code))
      ? EXIT.failure
      : gateFailed(visible, selected.failOn ?? "high")
        ? EXIT.threshold
        : EXIT.success;
}

async function writeNew(target: string, content: string): Promise<void> {
  try {
    const handle = await open(target, "wx", 0o600);
    try {
      await handle.writeFile(content, "utf8");
    } finally {
      await handle.close();
    }
  } catch {
    throw new KaevError("output", `${path.basename(target)} already exists or cannot be created.`);
  }
}

async function init(): Promise<void> {
  const target = path.resolve(CONFIG_FILE);
  await writeNew(target, `${JSON.stringify(defaultConfig, null, 2)}\n`);
  process.stdout.write(`Created ${target}\n`);
}

async function baseline(cli: Options): Promise<void> {
  const root = process.cwd();
  const { options: selected, config } = await resolved(root, cli);
  const result = await analyzeProject(root, {
    category: selected.category,
    ui5Lint: selected.ui5Lint,
    exclude: config.exclude,
  });
  const target = path.resolve(root, selected.baseline ?? ".kaev-baseline.json");
  if (!safeConfigPath(selected.baseline ?? ".kaev-baseline.json") || path.dirname(target) !== root)
    throw new KaevError("configuration", "Baseline must be a file in the project root.");
  await writeNew(target, `${JSON.stringify(createBaseline(result.findings), null, 2)}\n`);
  process.stdout.write(`Created ${target} with ${result.findings.length} finding(s).\n`);
}

function explain(ruleId: string): void {
  const rule = [...projectRules, ...sourceRules].find(
    (candidate) => candidate.meta.id.toLowerCase() === ruleId.toLowerCase(),
  );
  if (!rule) throw new KaevError("configuration", `Unknown rule ID: ${ruleId}`);
  const meta = rule.meta;
  process.stdout.write(
    `${meta.id} — ${meta.title}\n\nCategory: ${meta.category}\nSeverity: ${meta.defaultSeverity}\nBasis: ${meta.basis}\n\nWhy it matters:\n${meta.description}\n\nRecommendation:\n${meta.recommendation ?? "Review the finding in project context."}\n\nReferences: ${meta.references.join(", ") || "none"}\nDocumentation: ${meta.docs.path}\n`,
  );
}

async function workspace(cli: Options): Promise<void> {
  const root = process.cwd();
  const projects: string[] = [];
  async function find(directory: string, depth: number): Promise<void> {
    if (depth > 4 || projects.length >= 100) return;
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((entry) => entry.isFile() && entry.name === "ui5.yaml")) {
      if (directory !== root) projects.push(directory);
      return;
    }
    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        entry.isSymbolicLink() ||
        entry.name.startsWith(".") ||
        ["node_modules", "dist", "build", "coverage"].includes(entry.name)
      )
        continue;
      await find(path.join(directory, entry.name), depth + 1);
    }
  }
  await find(root, 0);
  if (!projects.length)
    throw new KaevError("configuration", "No UI5 projects were found within the workspace limits.");
  let exitCode: number = EXIT.success;
  for (const project of projects.sort()) {
    const configFile = await loadConfig(project);
    const config = { ...defaultConfig, ...configFile };
    const result = await analyzeProject(project, {
      category: cli.category ?? config.category,
      ui5Lint: cli.ui5Lint ?? config.ui5Lint,
      exclude: config.exclude,
    });
    const policy = await applyPolicy(result.findings, project, config);
    const visible = withCounts(result, policy.active);
    process.stdout.write(
      `\n=== ${path.basename(project)} ===\n${terminal(visible, {
        verbose: cli.verbose,
        quiet: cli.quiet,
        severity: cli.severity,
        color: useColor(cli.color),
      })}`,
    );
    if (result.summary.unavailable) exitCode = EXIT.failure;
    else if (
      exitCode < EXIT.threshold &&
      gateFailed(visible, cli.failOn ?? config.failOn ?? "high")
    )
      exitCode = EXIT.threshold;
  }
  process.exitCode = exitCode;
}

options(program).action(() => check(program.opts<Options>()));
options(program.command("check").description("Analyze the current project")).action(
  (_o, command: Command) => check(command.optsWithGlobals<Options>()),
);
options(program.command("report").description("Generate a detailed project report"), true)
  .option("--output <file>", "Explicit report target (must not exist)")
  .action((_o, command: Command) => check(command.optsWithGlobals<Options>(), true));
options(program.command("baseline").description("Create a baseline from current findings")).action(
  (_o, command: Command) => baseline(command.optsWithGlobals<Options>()),
);
options(program.command("workspace").description("Analyze UI5 projects in a monorepo")).action(
  (_o, command: Command) => workspace(command.optsWithGlobals<Options>()),
);
program.command("init").description("Create a safe default .kaevrc.json").action(init);
program
  .command("explain <rule-id>")
  .description("Explain a Kaev rule")
  .action((ruleId: string) => explain(ruleId));
program
  .command("doctor")
  .description("Diagnose project and Kaev setup")
  .action(async () => {
    const result = await runDoctor(process.cwd());
    process.stdout.write(result.output);
    process.exitCode = result.ready ? EXIT.success : EXIT.failure;
  });
program.addHelpText(
  "after",
  "\nExamples:\n  kaev\n  kaev check --category security\n  kaev check --format sarif > kaev.sarif\n  kaev check --fail-on medium --no-color\n  kaev init\n  kaev baseline\n  kaev explain KAEV-SEC-002\n  kaev workspace\n  kaev report --output ./reports/kaev.md\n  kaev doctor\n",
);
try {
  await program.parseAsync();
} catch (error) {
  if (error instanceof CommanderError)
    process.exitCode = error.exitCode === 0 ? EXIT.success : EXIT.failure;
  else {
    process.stderr.write(
      `${error instanceof KaevError ? error.message : "Analysis failed unexpectedly; source details withheld."}\n`,
    );
    process.exitCode = EXIT.failure;
  }
}
