import { expect, it } from "vitest";
import { secretName } from "../src/analysis/secrets.js";
import { Workspace } from "../src/analysis/workspace.js";
import { createRedactor, processFindings } from "../src/core/processing.js";
import { applicability, type Rule, runRules } from "../src/core/rules.js";
import { scoring } from "../src/core/scoring.js";
import { detectProject } from "../src/detectors/project.js";
import { sourceRules } from "../src/rules/source.js";
import { context } from "./helpers.js";

it("keeps runtime, spec and CLI versions separate", () => {
  expect(context().project).toMatchObject({
    ui5Version: "1.120.21",
    ui5SpecVersion: "3.0",
    ui5CliVersion: undefined,
    framework: "sapui5",
    odata: "v2",
    language: "javascript",
    projectType: "application",
  });
});
it("preserves ordinary package metadata while redacting credential values", () => {
  const c = context('const password = "alpha-delta-secret";', {
    "package.json": '{"name":"clean-ui5-project"}',
  });
  const redact = createRedactor(c.workspace);
  expect(redact("clean-ui5-project")).toBe("clean-ui5-project");
  expect(redact("alpha-delta-secret")).toBe("[REDACTED]");
  expect(secretName("access_token")).toBe(true);
});
it("preserves the exact XML opening position across multiline tags", () => {
  const c = context("", {
    "webapp/Main.view.xml":
      '<mvc:View xmlns:mvc="sap.ui.core.mvc" xmlns="sap.m">\n  <Button\n    text="Go"/>\n</mvc:View>',
  });
  expect(c.workspace.xml.get("webapp/Main.view.xml")?.[1]).toMatchObject({ line: 2, column: 3 });
});
it("rejects non-object project manifests without crashing", () => {
  const c = context("", { "webapp/manifest.json": "[]" });
  expect(c.workspace.diagnostics[0]).toMatchObject({
    code: "configuration",
    file: "webapp/manifest.json",
    line: 1,
    column: 1,
  });
});
it("does not mistake a minimum runtime requirement for the installed runtime", () => {
  const c = context("", {
    "ui5.yaml": 'specVersion: "3.0"\ntype: application',
    "webapp/manifest.json": '{"sap.ui5":{"dependencies":{"minUI5Version":"1.100.0"}}}',
  });
  expect(c.project.ui5Version).toBeUndefined();
  expect(c.project.minimumUi5Version).toBe("1.100.0");
});
it("detects OpenUI5 custom source roots and Fiori Elements V4 TypeScript", () => {
  const c = context("", {
    "ui5.yaml":
      'specVersion: "4.0"\ntype: application\nframework:\n  name: OpenUI5\nresources:\n  configuration:\n    paths:\n      webapp: app',
    "app/Component.ts": "export {};",
    "app/manifest.json":
      '{"sap.ui5":{"dependencies":{"libs":{"sap.fe.templates":{}}},"models":{"":{"type":"sap.ui.model.odata.v4.ODataModel"}}}}',
  });
  expect(c.project).toMatchObject({
    framework: "openui5",
    sourceRoots: ["app"],
    appType: "fiori-elements",
    odata: "v4",
    language: "typescript",
  });
});
it("detects legacy projects without manifests", () => {
  const w = new Workspace([
    {
      path: "webapp/Component.js",
      text: "sap.ui.define([], function() {});",
      origin: "application",
    },
  ]);
  expect(detectProject("/project", w)).toMatchObject({ detected: true, legacy: true });
});
it("does not classify arbitrary code as UI5", () =>
  expect(detectProject("/p", new Workspace([]))).toMatchObject({
    detected: false,
    framework: "unknown",
    odata: "unknown",
  }));
it.each(["library", "component", "theme-library", "module"])(
  "models %s without crashing",
  (type) => {
    const c = context("", { "ui5.yaml": `specVersion: "5.0"\ntype: ${type}` });
    expect(c.project.projectType).toBe(type);
  },
);
it("rejects unsafe source mappings", () => {
  const c = context("", {
    "ui5.yaml":
      'specVersion: "3.0"\ntype: application\nresources:\n  configuration:\n    paths:\n      webapp: ../../outside',
  });
  expect(c.project.sourceRoots).not.toContain("../../outside");
  expect(c.workspace.diagnostics.some((d) => d.code === "configuration")).toBe(true);
});
it("handles version, language and context applicability", () => {
  const p = context().project;
  expect(applicability({ odataVersions: ["v4"] }, p)).toBeDefined();
  expect(applicability({ odataVersions: ["v2"] }, p)).toBeUndefined();
  expect(applicability({ ui5Version: { min: "1.119.0", max: "1.121.0" } }, p)).toBeUndefined();
  expect(applicability({ ui5Version: { min: "1.121.0" } }, p)).toBeDefined();
  expect(applicability({ ui5SpecVersion: { min: "4.0" } }, p)).toBeDefined();
  expect(applicability({ projectTypes: ["library"] }, p)).toBeDefined();
  expect(applicability({ appTypes: ["fiori-elements"] }, p)).toBeDefined();
});
it("tracks skipped, not applicable and unavailable rules", async () => {
  const base = sourceRules[0] as Rule;
  const failed = {
    ...base,
    meta: { ...base.meta, id: "broken" },
    run() {
      throw new Error("secret");
    },
  };
  const r = await runRules([base, failed], context());
  expect(r.statuses.map((s) => s.status)).toEqual(["evaluated", "unavailable"]);
  expect((await runRules([base], context(), "security")).statuses[0]?.status).toBe("skipped");
});
it.each([
  ["broken.json", "{"],
  ["broken.yaml", "a: ["],
  ["broken.xml", "<broken>"],
  ["broken.js", "const ="],
  ["broken.ts", "const :"],
])("contains malformed %s failures", (path, text) => {
  const w = new Workspace([{ path, text, origin: "application" }]);
  expect(w.diagnostics).toHaveLength(1);
  expect(w.diagnostics[0]?.message).not.toContain(text);
});
it("rejects XML external entities", () => {
  const w = new Workspace([
    {
      path: "evil.xml",
      text: '<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><a>&x;</a>',
      origin: "application",
    },
  ]);
  expect(w.diagnostics).toHaveLength(1);
});
it("prefers security findings, deduplicates and weights modernization less", async () => {
  const c = context("element.innerHTML = input;");
  const r = await runRules(sourceRules, c);
  const f = processFindings([...r.findings, ...r.findings], createRedactor(c.workspace));
  expect(f.map((x) => x.ruleId)).toEqual(["ZET-SEC-003"]);
  const first = f[0];
  if (!first) throw new Error("missing");
  expect(scoring.score([{ ...first, severity: "critical", confidence: "high" }])).toBe(70);
  expect(scoring.score([{ ...first, kind: "modernization" }])).toBeGreaterThan(scoring.score(f));
});
