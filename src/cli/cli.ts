#!/usr/bin/env node
import { Command, CommanderError, Option } from "commander";
import { analyzeProject } from "../application/analyze-project.js";
import { createReport } from "../application/create-report.js";
import { runDoctor } from "../application/run-doctor.js";
import { type Category, categories, type Severity, severities } from "../core/types.js";
import { messages } from "../i18n/en.js";
import { json, terminal } from "../reporters/index.js";
import { EXIT, KaevError, VERSION } from "../shared/errors.js";

interface Options {
  verbose?: boolean;
  quiet?: boolean;
  category?: Category;
  severity?: Severity;
  format?: string;
  ui5Lint?: boolean;
  output?: string;
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
      new Option("--format <format>", "Output format")
        .choices(report ? ["markdown", "json"] : ["terminal", "json"])
        .default(report ? "markdown" : "terminal"),
    )
    .option("--no-ui5-lint", "Skip official UI5 Linter integration");
}
async function check(o: Options, report = false): Promise<void> {
  if (o.quiet && o.verbose)
    throw new KaevError("configuration", "--quiet and --verbose cannot be combined.");
  const result = await analyzeProject(process.cwd(), o);
  if (report) {
    const file = await createReport(
      result,
      process.cwd(),
      o.format === "json" ? "json" : "markdown",
      o.output,
    );
    process.stderr.write(`Report created: ${file}\n`);
  } else
    process.stdout.write(
      o.format === "json"
        ? json(result, o)
        : terminal(result, {
            ...o,
            color: process.stdout.isTTY && !("NO_COLOR" in process.env),
          }),
    );
  process.exitCode =
    result.summary.unavailable ||
    result.diagnostics.some((d) => ["parse", "filesystem", "configuration"].includes(d.code))
      ? EXIT.failure
      : result.findings.some((f) => f.severity === "high" || f.severity === "critical")
        ? EXIT.threshold
        : EXIT.success;
}
options(program).action(() => check(program.opts<Options>()));
options(program.command("check").description("Analyze the current project")).action(
  (_o, command: Command) => check(command.optsWithGlobals<Options>()),
);
options(program.command("report").description("Generate a detailed project report"), true)
  .option("--output <file>", "Explicit report target (must not exist)")
  .action((_o, command: Command) => check(command.optsWithGlobals<Options>(), true));
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
  "\nExamples:\n  kaev\n  kaev check --category security\n  kaev check --format json\n  kaev report --output ./reports/kaev.md\n  kaev doctor\n",
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
