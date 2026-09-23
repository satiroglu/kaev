import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run with npm run test:pack.");
const repository = process.cwd();
const temporary = await realpath(await mkdtemp(path.join(tmpdir(), "zetvik-pack-")));
function execute(file, args, cwd, expected = 0) {
  const result = spawnSync(file, args, {
    cwd,
    env: { ...process.env, npm_config_cache: path.join(temporary, "npm-cache") },
    encoding: "utf8",
    timeout: 90000,
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, expected, `${args.join(" ")}\n${result.stderr}\n${result.stdout}`);
  return result;
}
try {
  execute(process.execPath, [npmCli, "run", "build"], repository);
  const packed = JSON.parse(
    execute(
      process.execPath,
      [npmCli, "pack", "--ignore-scripts", "--json", "--pack-destination", temporary],
      repository,
    ).stdout,
  )[0];
  assert(
    packed.files.every((file) => /^(?:dist\/|docs\/|README.md$|package.json$)/.test(file.path)),
    "Unexpected files in npm package",
  );
  const tarball = path.join(temporary, packed.filename);
  execute(
    process.execPath,
    [
      npmCli,
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--prefix",
      temporary,
      tarball,
    ],
    repository,
  );
  const cli = path.join(temporary, "node_modules/zetvik/dist/cli/cli.js");
  assert.equal(execute(process.execPath, [cli, "--version"], temporary).stdout.trim(), "0.1.0");
  assert(execute(process.execPath, [cli, "--help"], temporary).stdout.includes("doctor"));
  for (const [name, expected] of [
    ["clean-project", 0],
    ["insecure-project", 1],
    ["custom-source-root", 0],
    ["malformed-project", 2],
    ["legacy-ui5", 0],
  ]) {
    const project = path.join(temporary, name);
    await cp(path.join(repository, "tests/fixtures", name), project, { recursive: true });
    const options = name === "malformed-project" ? ["--no-ui5-lint"] : [];
    const result = JSON.parse(
      execute(process.execPath, [cli, "check", "--format", "json", ...options], project, expected)
        .stdout,
    );
    assert.equal(result.schemaVersion, 1);
    if (!["malformed-project", "legacy-ui5"].includes(name))
      assert.equal(result.rules.find((rule) => rule.ruleId === "UI5-LINTER")?.status, "evaluated");
    if (name === "legacy-ui5")
      assert.equal(
        result.rules.find((rule) => rule.ruleId === "UI5-LINTER")?.status,
        "not-applicable",
      );
    assert(!JSON.stringify(result).includes("fake_live_9Az7bQ2mX4pR8tUv"));
    console.log(`Packed CLI: ${name} passed`);
  }
  const clean = path.join(temporary, "clean-project");
  execute(process.execPath, [cli, "doctor"], clean);
  execute(process.execPath, [cli, "--no-ui5-lint"], clean);
  execute(
    process.execPath,
    [cli, "report", "--no-ui5-lint", "--output", path.join(temporary, "report.md")],
    clean,
  );
  assert((await readFile(path.join(temporary, "report.md"), "utf8")).includes("# Zetvik"));
  execute(
    process.execPath,
    [
      cli,
      "report",
      "--format",
      "json",
      "--no-ui5-lint",
      "--output",
      path.join(temporary, "report.json"),
    ],
    clean,
  );
  assert.equal(
    JSON.parse(await readFile(path.join(temporary, "report.json"), "utf8")).schemaVersion,
    1,
  );
  execute(
    process.execPath,
    [cli, "report", "--no-ui5-lint", "--output", path.join(temporary, "report.md")],
    clean,
    2,
  );
  console.log(`Package contents: ${packed.files.length} files; all packed-artifact checks passed.`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
