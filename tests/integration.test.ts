import { execFileSync, spawnSync } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import { analyzeProject } from "../src/application/analyze-project.js";
import { createReport } from "../src/application/create-report.js";
import { runDoctor } from "../src/application/run-doctor.js";
import type { AnalysisResult } from "../src/core/types.js";
import { discover } from "../src/filesystem/discovery.js";
import { github, json, junit, markdown, sarif, terminal } from "../src/reporters/index.js";

const fixture = (name: string) => path.resolve("tests/fixtures", name);
const temps: string[] = [];
async function temporary() {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), "kaev-test-")));
  temps.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true });
});
it.each([
  "freestyle-v2-js",
  "freestyle-v4-ts",
  "fiori-elements-v4",
  "legacy-ui5",
  "insecure-project",
  "clean-project",
  "malformed-project",
  "custom-source-root",
])("analyzes %s deterministically without writes", async (name) => {
  const root = fixture(name);
  const before = await discover(root);
  const first = await analyzeProject(root, { ui5Lint: false });
  const second = await analyzeProject(root, { ui5Lint: false });
  expect(first.findings).toEqual(second.findings);
  expect(first.scores).toEqual(second.scores);
  expect((await discover(root)).files).toEqual(before.files);
});
it("redacts every reporter including verbose, and does not reveal absolute paths", async () => {
  const r = await analyzeProject(fixture("insecure-project"), { ui5Lint: false });
  for (const output of [json(r), markdown(r), terminal(r, { verbose: true })]) {
    expect(output).not.toContain("fake_live_9Az7bQ2mX4pR8tUv");
    expect(output).not.toContain(fixture("insecure-project"));
    expect(output).not.toContain("\x1b");
  }
  expect(JSON.parse(json(r)).schemaVersion).toBe(1);
  expect(markdown(r)).toContain("## High-priority findings");
});
it("colors terminal output only when explicitly enabled", async () => {
  const r = await analyzeProject(fixture("insecure-project"), { ui5Lint: false });
  expect(terminal(r)).not.toContain("\x1b");
  expect(terminal(r, { color: true })).toContain("\x1b[31mHIGH\x1b[0m");
});
it("groups passed and failed checks by category in human-readable reports", async () => {
  const clean = await analyzeProject(fixture("clean-project"), { ui5Lint: false });
  const insecure = await analyzeProject(fixture("insecure-project"), { ui5Lint: false });
  expect(terminal(clean)).toContain("Configuration\n  ✓ PASS  Manifest readability");
  expect(terminal(insecure)).toContain(
    "Security\n  ✗ ISSUE  Frontend credential exposure · KAEV-SEC-001 · 1 finding(s)",
  );
  expect(markdown(clean)).toContain("| PASS | Manifest readability (KAEV-CONFIG-001) |");
  expect(markdown(insecure)).toContain(
    "| ISSUE | Frontend credential exposure (KAEV-SEC-001) | 1 finding\\(s\\) |",
  );
});
it("produces valid CI reporters without terminal escapes", async () => {
  const r = await analyzeProject(fixture("insecure-project"), { ui5Lint: false });
  const sarifResult = JSON.parse(sarif(r));
  expect(sarifResult.version).toBe("2.1.0");
  expect(sarifResult.runs[0].results.length).toBe(r.findings.length);
  expect(junit(r)).toMatch(/^<\?xml version="1\.0"/);
  expect(junit(r)).toContain("<failure");
  expect(junit(r)).toContain("KAEV-CONFIG-001: Manifest readability");
  expect(github(r)).toContain("::error ");
  expect(`${sarif(r)}${junit(r)}${github(r)}`).not.toContain("\x1b");
});
it("never overwrites an existing report or follows a report symlink", async () => {
  const r = await analyzeProject(fixture("clean-project"), { ui5Lint: false });
  const dir = await temporary();
  const output = await createReport(r, dir, "markdown");
  expect(path.basename(output)).toMatch(
    /^kaev-report-clean-ui5-project-\d{8}-\d{6}-\d{3}[+-]\d{4}\.md$/,
  );
  expect(await readFile(output, "utf8")).toContain("# Kaev");
  expect(await readFile(output, "utf8")).toContain("Generated locally:");
  expect(await readFile(output, "utf8")).toContain(`UTC: ${r.generatedAt}`);
  await expect(createReport(r, dir, "markdown")).rejects.toThrow("never overwritten");
  await writeFile(path.join(dir, "secret.md"), "unchanged");
  await symlink(path.join(dir, "secret.md"), path.join(dir, "link.md"));
  await expect(createReport(r, dir, "markdown", "link.md")).rejects.toThrow();
  expect(await readFile(path.join(dir, "secret.md"), "utf8")).toBe("unchanged");
});
it("ignores dependencies, links, large files and binary files", async () => {
  const dir = await temporary();
  await mkdir(path.join(dir, "node_modules"));
  await writeFile(path.join(dir, "node_modules/secret.js"), "eval(secret)");
  await writeFile(path.join(dir, "big.js"), "x".repeat(1024 * 1024 + 1));
  await writeFile(path.join(dir, "binary.js"), Buffer.from([0, 1]));
  await symlink(fixture("insecure-project"), path.join(dir, "linked"));
  const found = await discover(dir);
  expect(found.files).toEqual([]);
  expect(found.diagnostics.map((d) => d.code)).toEqual(
    expect.arrayContaining(["limit", "binary", "symlink"]),
  );
});
it("doctor is read only and does not invoke full rule analysis", async () => {
  const root = fixture("clean-project");
  const before = await readdir(root);
  expect((await runDoctor(root)).ready).toBe(true);
  expect(await readdir(root)).toEqual(before);
});
it("CLI help, version, JSON, report and failures have stable behavior", async () => {
  execFileSync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json"]);
  const cli = path.resolve("dist/cli/cli.js");
  const run = (args: string[], cwd = fixture("clean-project")) =>
    spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
  expect(run(["--help"]).stdout).toContain("doctor");
  const expectedVersion = JSON.parse(await readFile(path.resolve("package.json"), "utf8")).version;
  expect(run(["--version"]).stdout.trim()).toBe(expectedVersion);
  expect(run(["--bad-option"]).status).toBe(2);
  const result = run(["check", "--format", "json", "--no-ui5-lint"]);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout).schemaVersion).toBe(1);
  expect(JSON.parse(result.stdout).kaevVersion).toBe(expectedVersion);
  expect(JSON.parse(result.stdout).project.packageName).toBe("clean-ui5-project");
  const filtered = run(
    ["check", "--format", "json", "--no-ui5-lint", "--severity", "critical"],
    fixture("insecure-project"),
  );
  expect(filtered.status).toBe(1);
  expect(
    JSON.parse(filtered.stdout).findings.every(
      (f: { severity: string }) => f.severity === "critical",
    ),
  ).toBe(true);
  expect(run(["--no-ui5-lint"]).stdout).toBe(run(["check", "--no-ui5-lint"]).stdout);
  expect(run(["--no-ui5-lint"], fixture("insecure-project")).status).toBe(1);
  expect(run(["--no-ui5-lint", "--fail-on", "none"], fixture("insecure-project")).status).toBe(0);
  expect(JSON.parse(run(["--no-ui5-lint", "--format", "sarif"]).stdout).version).toBe("2.1.0");
  expect(run(["--no-ui5-lint", "--format", "junit"]).stdout).toContain("<testsuites");
  expect(
    run(["--no-ui5-lint", "--format", "github"], fixture("insecure-project")).stdout,
  ).toContain("::");
  expect(run(["explain", "KAEV-SEC-002"]).stdout).toContain("KAEV-SEC-002");
  expect(run(["doctor"]).status).toBe(0);
  const dir = await temporary();
  const out = path.join(dir, "report.md");
  expect(run(["report", "--no-ui5-lint", "--output", out]).status).toBe(0);
  expect(await readFile(out, "utf8")).toContain("# Kaev");
  const configDir = await temporary();
  await mkdir(path.join(configDir, "webapp"));
  await writeFile(path.join(configDir, "ui5.yaml"), 'specVersion: "3.0"\ntype: application');
  await writeFile(path.join(configDir, "webapp/Component.js"), "sap.ui.define([], () => {});");
  expect(run(["init"], configDir).status).toBe(0);
  expect(JSON.parse(await readFile(path.join(configDir, ".kaevrc.json"), "utf8")).version).toBe(1);
  expect(run(["baseline", "--no-ui5-lint"], configDir).status).toBe(0);
  expect(
    JSON.parse(await readFile(path.join(configDir, ".kaev-baseline.json"), "utf8")).version,
  ).toBe(1);
  const baselineDir = await temporary();
  await cp(fixture("insecure-project"), baselineDir, { recursive: true });
  expect(run(["init"], baselineDir).status).toBe(0);
  expect(run(["baseline", "--no-ui5-lint"], baselineDir).status).toBe(0);
  const afterBaseline = run(["check", "--format", "json", "--no-ui5-lint"], baselineDir);
  expect(afterBaseline.status).toBe(0);
  expect(JSON.parse(afterBaseline.stdout).findings).toHaveLength(0);
  expect(run(["check", "--no-ui5-lint", "--no-color"], baselineDir).stdout).toContain(
    "⊘ SUPPRESSED  Frontend credential exposure",
  );
  const invalidDir = await temporary();
  await cp(fixture("clean-project"), invalidDir, { recursive: true });
  await writeFile(path.join(invalidDir, ".kaevrc.json"), '{"version":1,"unknown":true}');
  expect(run(["check", "--no-ui5-lint"], invalidDir).status).toBe(2);
  const monorepo = await temporary();
  await mkdir(path.join(monorepo, "packages"));
  await cp(fixture("clean-project"), path.join(monorepo, "packages/app"), { recursive: true });
  const workspaceResult = run(["workspace", "--no-ui5-lint"], monorepo);
  expect(workspaceResult.status).toBe(0);
  expect(workspaceResult.stdout).toContain("=== app ===");

  // Debug options (--debug and KAEV_DEBUG=1) and safe error handling
  const safeRun = run(["baseline", "--baseline", "../outside.json"], dir);
  expect(safeRun.status).toBe(2);
  expect(safeRun.stderr).toContain("Baseline must be a file in the project root.");
  expect(safeRun.stderr).not.toContain("at ");

  const debugRun = run(["baseline", "--debug", "--baseline", "../outside.json"], dir);
  expect(debugRun.status).toBe(2);
  expect(debugRun.stderr).toContain("at ");

  const envDebugRun = spawnSync(
    process.execPath,
    [cli, "baseline", "--baseline", "../outside.json"],
    { cwd: dir, encoding: "utf8", env: { ...process.env, KAEV_DEBUG: "1" } },
  );
  expect(envDebugRun.status).toBe(2);
  expect(envDebugRun.stderr).toContain("at ");
}, 20000);
it("blocks networking in the analyzer process without changing the parent process", () => {
  const uri = pathToFileURL(path.resolve("dist/adapters/ui5-linter/offline.js")).href;
  const script = `import {disableNetwork} from ${JSON.stringify(uri)};
    import http from 'node:http'; import net from 'node:net'; import dns from 'node:dns';
    disableNetwork(); let blocked = 0;
    for (const action of [() => fetch('http://127.0.0.1:9'), () => http.get('http://127.0.0.1:9'), () => net.connect(9), () => dns.lookup('localhost', () => {})]) {
      try { action(); } catch (e) { if (e.message.includes('Network access is disabled')) blocked++; }
    }
    if (blocked !== 4) process.exitCode = 1;`;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
  });
  expect(child.stderr).toBe("");
  expect(child.status).toBe(0);
});
it("fails closed when the official analyzer cannot resolve a project namespace", async () => {
  const dir = await temporary();
  await mkdir(path.join(dir, "webapp"));
  await writeFile(
    path.join(dir, "ui5.yaml"),
    'specVersion: "3.0"\ntype: application\nmetadata:\n  name: broken',
  );
  await writeFile(path.join(dir, "webapp/util.js"), "export const answer = 42;");
  await writeFile(path.join(dir, "webapp/manifest.json"), "{}");
  const child = spawnSync(process.execPath, [path.resolve("dist/cli/cli.js"), "--format", "json"], {
    cwd: dir,
    encoding: "utf8",
  });
  const result: AnalysisResult = JSON.parse(child.stdout);
  expect(child.status).toBe(2);
  expect(result.rules.find((r) => r.ruleId === "UI5-LINTER")?.status).toBe("unavailable");
  expect(result.scores.partial).toBe(true);
});
it("official adapter runs without executing project config and preserves read-only sources", async () => {
  const dir = await temporary();
  await mkdir(path.join(dir, "webapp"));
  await writeFile(
    path.join(dir, "webapp/manifest.json"),
    '{"sap.app":{"id":"test.app","type":"application"},"sap.ui5":{}}',
  );
  await writeFile(path.join(dir, "webapp/Component.js"), "sap.ui.getCore();");
  await writeFile(
    path.join(dir, "ui5lint.config.mjs"),
    'throw new Error("THIS MUST NEVER EXECUTE");',
  );
  const before = (await discover(dir)).files;
  // Exercise the built worker as installed users do, rather than asking Node to
  // execute an uncompiled worker.js alongside TypeScript test sources.
  for (let attempt = 0; attempt < 5; attempt++) {
    const child = spawnSync(
      process.execPath,
      [path.resolve("dist/cli/cli.js"), "check", "--format", "json"],
      { cwd: dir, encoding: "utf8", timeout: 35000 },
    );
    expect(child.stderr).toBe("");
    const r: AnalysisResult = JSON.parse(child.stdout);
    expect(r.rules.find((rule) => rule.ruleId === "UI5-LINTER")).toMatchObject({
      status: "evaluated",
    });
    expect(r.findings.some((finding) => finding.ruleId.startsWith("UI5LINT/"))).toBe(true);
  }
  expect((await discover(dir)).files).toEqual(before);
}, 40000);
it("keeps manifest-less legacy projects useful when the official adapter is not applicable", async () => {
  const r = await analyzeProject(fixture("legacy-ui5"));
  expect(r.project.legacy).toBe(true);
  expect(r.rules.find((rule) => rule.ruleId === "UI5-LINTER")?.status).toBe("not-applicable");
  expect(r.scores.partial).toBe(false);
});
