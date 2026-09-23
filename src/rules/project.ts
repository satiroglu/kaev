import { at } from "../analysis/workspace.js";
import { define } from "./catalog.js";
export const projectRules = [
  define(
    {
      id: "ZET-PROJ-001",
      title: "UI5 project could not be identified",
      category: "project",
      severity: "info",
      basis: "heuristic",
      why: "Insufficient UI5 evidence limits project-specific analysis.",
      recommendation: "Run Zetvik from an individual UI5 project root.",
    },
    ({ project }, f) => (project.detected ? [] : [f()]),
  ),
  define(
    {
      id: "ZET-CONFIG-001",
      title: "Manifest cannot be parsed",
      category: "config",
      severity: "high",
      basis: "derived",
      references: ["config"],
      why: "An invalid descriptor prevents reliable application configuration.",
      recommendation: "Correct the manifest syntax and rerun doctor.",
    },
    ({ workspace }, f) =>
      workspace.diagnostics
        .filter(
          (d) =>
            d.file?.endsWith("manifest.json") &&
            ["parse", "filesystem", "configuration"].includes(d.code),
        )
        .map((d) => f({ file: d.file, line: d.line, column: d.column })),
  ),
  define(
    {
      id: "ZET-CONFIG-002",
      title: "Expected UI5 configuration is missing or malformed",
      category: "config",
      severity: "medium",
      basis: "derived",
      references: ["config"],
      why: "UI5 tooling needs readable project configuration.",
      recommendation: "Provide a valid ui5.yaml for this tooling project.",
    },
    ({ workspace, project }, f) =>
      (workspace.has("ui5.yaml") && !workspace.get("ui5.yaml")) ||
      (!workspace.has("ui5.yaml") && project.ui5CliVersionRange)
        ? [f({ file: "ui5.yaml" })]
        : [],
  ),
  define(
    {
      id: "ZET-CONFIG-003",
      title: "UI5 project configuration is inconsistent",
      category: "config",
      severity: "medium",
      basis: "official",
      references: ["config"],
      why: "UI5 project configuration requires a specification version and a supported project type.",
      recommendation: "Validate the project using the matching UI5 CLI specification.",
    },
    ({ workspace, project }, f) =>
      workspace.get("ui5.yaml") &&
      (!project.ui5SpecVersion ||
        project.projectType === "unknown" ||
        (at(workspace.get("ui5.yaml"), "type") === "component" &&
          Number(project.ui5SpecVersion) < 5))
        ? [f({ file: "ui5.yaml" })]
        : [],
  ),
  define(
    {
      id: "ZET-UI5-001",
      title: "Interactive control lacks a stable ID",
      category: "ui5",
      severity: "medium",
      basis: "official",
      references: ["stableIds"],
      why: "Stable IDs support flexibility and adaptation of interactive controls.",
      recommendation: "Assign a stable view-local ID; consider template aggregation semantics.",
    },
    ({ workspace, project }, f) => {
      const findings = [];
      for (const [file, elements] of workspace.xml) {
        if (
          !/\.(view|fragment)\.xml$/.test(file) ||
          !project.sourceRoots.some((r) => r === "." || file.startsWith(`${r}/`))
        )
          continue;
        for (const e of elements)
          if (
            e.uri === "sap.m" &&
            ["Button", "Input", "Select", "Table", "List"].includes(e.name) &&
            !e.attributes.id
          )
            findings.push(
              f({
                file,
                line: e.line,
                column: e.column,
                message:
                  "A flexibility-enabled application contains an interactive control without an explicit ID.",
              }),
            );
      }
      return findings;
    },
    { projectTypes: ["application"], appTypes: ["freestyle"], flexibility: true },
  ),
];
