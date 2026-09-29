import semver from "semver";
import ts from "typescript";
import { literal, walk } from "../analysis/ast.js";
import { at, object, string, type Workspace } from "../analysis/workspace.js";
import type { ProjectContext } from "../core/types.js";
import { safeRelative } from "../filesystem/discovery.js";
import { normalizeWorkspacePath } from "../filesystem/paths.js";

export function detectProject(root: string, w: Workspace): ProjectContext {
  const pkg = w.get("package.json");
  const config = w.get("ui5.yaml");
  const deps = { ...object(at(pkg, "dependencies")), ...object(at(pkg, "devDependencies")) };
  const type = string(at(config, "type"));
  const projectType =
    type && ["application", "component", "library", "theme-library", "module"].includes(type)
      ? (type as ProjectContext["projectType"])
      : "unknown";
  const paths = object(at(config, "resources", "configuration", "paths"));
  const configured =
    projectType === "module"
      ? Object.values(paths)
      : [paths[projectType === "application" ? "webapp" : "src"]];
  const sourceRoots = configured
    .filter((p): p is string => typeof p === "string" && safeRelative(p))
    .map((p) => normalizeWorkspacePath(p).replace(/\/$/, "") || ".");
  if (configured.some((p) => typeof p === "string" && !safeRelative(p)))
    w.diagnostics.push({
      code: "configuration",
      file: "ui5.yaml",
      message: "Unsafe source mapping rejected; paths must remain inside the project.",
    });
  if (!sourceRoots.length) {
    const conventional =
      projectType === "application" || projectType === "unknown" ? "webapp" : "src";
    if (w.files.some((f) => f.path.startsWith(`${conventional}/`))) sourceRoots.push(conventional);
    else if (w.has("manifest.json") || w.has("Component.js") || w.has("Component.ts"))
      sourceRoots.push(".");
    else {
      const legacyRoot = ["WebContent", "src/main/webapp"].find((r) =>
        w.files.some((f) => f.path.startsWith(`${r}/`)),
      );
      if (legacyRoot) sourceRoots.push(legacyRoot);
    }
  }
  const manifests = w.files.filter(
    (f) =>
      f.path.endsWith("manifest.json") &&
      sourceRoots.some((r) => f.path === (r === "." ? "manifest.json" : `${r}/manifest.json`)),
  );
  const manifest = w.get(manifests[0]?.path ?? "");
  const ui5 = at(manifest, "sap.ui5");
  const frameworkName = string(at(config, "framework", "name"))?.toLowerCase();
  const framework =
    frameworkName === "sapui5" || frameworkName === "openui5"
      ? frameworkName
      : Object.keys(deps).some((d) => d.startsWith("@sapui5/"))
        ? "sapui5"
        : Object.keys(deps).some((d) => d.startsWith("@openui5/"))
          ? "openui5"
          : "unknown";
  const sources = w.files.filter((f) =>
    sourceRoots.some((r) => r === "." || f.path.startsWith(`${r}/`)),
  );
  const legacyEvidence =
    sources.some(
      (f) =>
        /(?:Component\.[jt]s$)/.test(f.path) &&
        /(?:sap\.ui\.(?:define|core)|UIComponent|jQuery\.sap)/.test(f.text),
    ) || sources.some((f) => f.path.endsWith(".html") && /sap-ui-core\.js/.test(f.text));
  const detected =
    ui5 !== undefined ||
    framework !== "unknown" ||
    legacyEvidence ||
    !!(type && at(config, "specVersion"));
  const dataSources = object(at(manifest, "sap.app", "dataSources"));
  const versions = new Set<"v2" | "v4">();
  const services: string[] = [];
  const models: Record<string, "v2" | "v4"> = {};
  for (const source of sources) {
    const ast = w.ast.get(source.path);
    if (!ast) continue;
    walk(ast, (node) => {
      if (ts.isImportDeclaration(node)) {
        const name = literal(node.moduleSpecifier);
        if (name === "sap/ui/model/odata/v2/ODataModel" || name === "sap/ui/model/odata/ODataModel")
          versions.add("v2");
        else if (name === "sap/ui/model/odata/v4/ODataModel") versions.add("v4");
      }
      if (ts.isNewExpression(node)) {
        const name = node.expression.getText(ast);
        if (name === "sap.ui.model.odata.v2.ODataModel" || name === "sap.ui.model.odata.ODataModel")
          versions.add("v2");
        else if (name === "sap.ui.model.odata.v4.ODataModel") versions.add("v4");
      }
      if (
        ts.isCallExpression(node) &&
        ["sap.ui.define", "sap.ui.require"].includes(node.expression.getText(ast))
      ) {
        const deps = node.arguments[0];
        if (deps && ts.isArrayLiteralExpression(deps))
          for (const dep of deps.elements) {
            const name = literal(dep);
            if (
              name === "sap/ui/model/odata/v2/ODataModel" ||
              name === "sap/ui/model/odata/ODataModel"
            )
              versions.add("v2");
            else if (name === "sap/ui/model/odata/v4/ODataModel") versions.add("v4");
          }
      }
    });
  }
  for (const ds of Object.values(dataSources)) {
    if (at(ds, "type") !== "OData") continue;
    const version = at(ds, "settings", "odataVersion");
    if (version === "4.0") versions.add("v4");
    else if (version === "2.0" || version === undefined) versions.add("v2");
    const uri = string(at(ds, "uri"));
    if (uri) services.push(uri);
  }
  for (const [name, model] of Object.entries(object(at(ui5, "models")))) {
    const modelType = string(at(model, "type"));
    const ds = dataSources[string(at(model, "dataSource")) ?? ""];
    if (
      modelType === "sap.ui.model.odata.v4.ODataModel" ||
      at(ds, "settings", "odataVersion") === "4.0"
    ) {
      models[name] = "v4";
      versions.add("v4");
    } else if (
      modelType === "sap.ui.model.odata.v2.ODataModel" ||
      modelType === "sap.ui.model.odata.ODataModel" ||
      (!modelType && at(ds, "type") === "OData")
    ) {
      models[name] = "v2";
      versions.add("v2");
    }
  }
  const js = sources.some((f) => /\.[cm]?js$/.test(f.path));
  const hasTypeScript = sources.some((f) => f.path.endsWith(".ts"));
  const fe =
    at(manifest, "sap.ui.generic.app") !== undefined ||
    Object.keys(object(at(ui5, "dependencies", "libs"))).some((k) => k.startsWith("sap.fe.")) ||
    JSON.stringify(at(ui5, "routing") ?? {}).includes("sap.fe.templates");
  const runtime = string(at(config, "framework", "version"));
  const spec = at(config, "specVersion");
  const minimum = string(at(ui5, "dependencies", "minUI5Version"));
  return {
    rootPath: root,
    packageName: string(at(pkg, "name")),
    framework,
    detected,
    ui5Version: runtime && semver.valid(runtime) ? runtime : undefined,
    minimumUi5Version: minimum,
    ui5SpecVersion: typeof spec === "string" || typeof spec === "number" ? String(spec) : undefined,
    ui5CliVersion:
      typeof deps["@ui5/cli"] === "string" && semver.valid(deps["@ui5/cli"])
        ? deps["@ui5/cli"]
        : undefined,
    ui5CliVersionRange: string(deps["@ui5/cli"]),
    projectType: projectType === "unknown" && ui5 ? "application" : projectType,
    appType: fe
      ? "fiori-elements"
      : ui5 && (at(ui5, "rootView") || at(ui5, "routing"))
        ? "freestyle"
        : "unknown",
    language:
      js && hasTypeScript ? "mixed" : hasTypeScript ? "typescript" : js ? "javascript" : "unknown",
    odata:
      versions.size === 2
        ? "mixed"
        : versions.has("v2")
          ? "v2"
          : versions.has("v4")
            ? "v4"
            : manifest
              ? "none"
              : "unknown",
    backend: deps["@sap/cds"]
      ? "cap"
      : services.some((s) => s.includes("/sap/opu/odata"))
        ? "abap"
        : "unknown",
    deployment:
      w.has("ui5-deploy.yaml") && JSON.stringify(w.get("ui5-deploy.yaml")).includes("abap")
        ? "abap-repository"
        : w.has("mta.yaml") && JSON.stringify(w.get("mta.yaml")).includes("html5-apps-repo")
          ? "btp-html5"
          : "unknown",
    sourceRoots,
    legacy: legacyEvidence && !ui5,
    evidence: [
      ...(ui5 ? ["UI5 manifest"] : []),
      ...(frameworkName ? ["UI5 framework configuration"] : []),
      ...(legacyEvidence ? ["UI5 component/bootstrap"] : []),
    ],
    files: Object.fromEntries(
      [
        "package.json",
        "ui5.yaml",
        "ui5-deploy.yaml",
        "ui5-workspace.yaml",
        "xs-app.json",
        "mta.yaml",
      ]
        .map((f) => [f, w.has(f)])
        .concat([["manifest.json", manifests.length > 0]]),
    ),
    services,
    models,
    flexibility: at(ui5, "flexEnabled") === true,
  };
}
