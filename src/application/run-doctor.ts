import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import semver from "semver";
import { CONFIG_FILE, loadConfig } from "../config/config.js";
import { createRedactor } from "../core/processing.js";
import { VERSION } from "../shared/errors.js";
import { prepare } from "./analyze-project.js";
export async function runDoctor(root: string): Promise<{ output: string; ready: boolean }> {
  const config = await loadConfig(root);
  const { project, workspace } = await prepare(root);
  const redact = createRedactor(workspace);
  let adapter = true;
  try {
    createRequire(import.meta.url).resolve("@ui5/linter");
  } catch {
    adapter = false;
  }
  const ready =
    semver.gte(process.versions.node, "22.9.0") &&
    project.detected &&
    project.sourceRoots.length > 0 &&
    !workspace.diagnostics.some((d) => ["parse", "filesystem", "configuration"].includes(d.code));
  const lines = [
    `Kaev Doctor ${VERSION}`,
    "",
    `Node.js ${process.versions.node}`,
    `Platform: ${process.platform} ${process.arch}`,
    `Configuration: ${config ? CONFIG_FILE : "defaults"}`,
    `Project: ${project.detected ? "UI5 detected" : "not identified"}`,
    `Framework: ${project.framework}`,
    `UI5 runtime: ${project.ui5Version ?? "unknown"}`,
    `UI5 CLI spec: ${project.ui5SpecVersion ?? "unknown"}`,
    `OData: ${project.odata}`,
    `Source roots: ${project.sourceRoots.join(", ") || "unresolved"}`,
    `UI5 Linter integration: ${adapter ? "installed (execution checked during analysis)" : "unavailable"}`,
  ];
  if (config?.baseline) {
    let baseline = false;
    try {
      await access(path.resolve(root, config.baseline));
      baseline = true;
    } catch {
      // A missing baseline is valid until the baseline command is used.
    }
    lines.push(`Baseline: ${baseline ? `${config.baseline} discovered` : "not present"}`);
  }
  for (const [file, exists] of Object.entries(project.files))
    lines.push(`${file}: ${exists ? "discovered" : "not present"}`);
  for (const d of workspace.diagnostics) lines.push(`${d.file ?? "project"}: ${d.message}`);
  lines.push(
    "",
    ready ? "Ready for analysis." : "Analysis readiness is limited; review diagnostics.",
  );
  return { output: `${redact(lines.join("\n"))}\n`, ready };
}
