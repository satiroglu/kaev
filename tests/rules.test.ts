import { describe, expect, it } from "vitest";
import { runRules } from "../src/core/rules.js";
import { projectRules } from "../src/rules/project.js";
import { sourceRules } from "../src/rules/source.js";
import { context } from "./helpers.js";

const model = "const model = this.getOwnerComponent().getModel();";
const cases = [
  [
    "KAEV-ODATA-001",
    `${model} model.read('/Orders', {success(data) { return data.results.filter(x => x.open); }});`,
    "const localOptions = []; localOptions.filter(x => x);",
  ],
  [
    "KAEV-ODATA-002",
    `${model} model.read('/Orders', {success: function(data) { return data.results.sort(); }});`,
    "const data = {results: []}; data.results.sort();",
  ],
  ["KAEV-ODATA-003", `${model} model.setSizeLimit(99999);`, `${model} model.setSizeLimit(100);`],
  [
    "KAEV-ARCH-001",
    'fetch("/sap/opu/odata/sap/TEST/Orders");',
    'fetch("https://example.org/weather");',
  ],
  ["KAEV-ARCH-002", 'element.innerHTML = "hello";', 'document.querySelector("button");'],
  [
    "KAEV-PERF-001",
    `${model} for (const item of items) { model.refresh(); }`,
    `${model} model.refresh();`,
  ],
  [
    "KAEV-SEC-001",
    'const apiKey = "sk_live_9Az7bQ2mX4pR8tUv";',
    'const password = "placeholder"; const passwordLabel = "Password";',
  ],
  [
    "KAEV-SEC-002",
    'localStorage.setItem("accessToken", accessToken);',
    'localStorage.setItem("theme", "dark");',
  ],
  ["KAEV-SEC-003", "element.innerHTML = userInput;", 'element.innerHTML = "<b>Hello</b>";'],
  ["KAEV-SEC-004", "eval(code); new Function(code);", "JSON.parse(data);"],
  [
    "KAEV-SEC-005",
    'fetch("http://backend.internal/service");',
    'fetch("http://localhost:4004/service");',
  ],
  ["KAEV-SEC-006", "console.log(accessToken);", 'console.log("Loaded", itemCount);'],
  [
    "KAEV-SEC-007",
    'if (user.isAdmin) { this.byId("deleteButton").setVisible(true); }',
    'if (busy) { this.byId("saveButton").setEnabled(false); }',
  ],
  [
    "KAEV-SEC-008",
    'fetch("/sap/opu/odata/sap/TEST/Orders", {method: "POST"});',
    'fetch("/thirdparty/Orders", {method: "POST"});',
  ],
] as const;
describe.each(cases)("%s precision", (id, positive, negative) => {
  const rule = sourceRules.find((r) => r.meta.id === id);
  it("detects the intended pattern", async () => {
    expect(rule).toBeDefined();
    expect((await rule?.run(context(positive)))?.length).toBeGreaterThan(0);
  });
  it("does not flag the counterexample", async () => {
    expect(await rule?.run(context(negative))).toEqual([]);
  });
});
it("traces imported OData model and local collection aliases", async () => {
  const c = context(
    'import ODataModel from "sap/ui/model/odata/v2/ODataModel"; const model = new ODataModel("/service"); const data = model.getProperty("/Orders"); data.filter(x => x);',
  );
  expect(await sourceRules[0]?.run(c)).toHaveLength(1);
});
it("does not classify a JSONModel or unrelated read callback as OData", async () => {
  const c = context(
    'import JSONModel from "sap/ui/model/json/JSONModel"; const model = new JSONModel(); model.read("/Orders", {success(data) { data.results.filter(x=>x); }});',
  );
  expect(await sourceRules[0]?.run(c)).toEqual([]);
});
it("does not follow reassigned collection aliases", async () => {
  const c = context(
    `${model} let data = model.getProperty('/Orders'); data = localOptions; data.filter(x => x);`,
  );
  expect(await sourceRules[0]?.run(c)).toEqual([]);
});
it("detects structured credentials with exact location but not harmless strings", async () => {
  const c = context("", {
    "webapp/config.json":
      '{\n  "apiKey": "sk_live_9Az7bQ2mX4pR8tUv",\n  "passwordLabel": "Password"\n}',
  });
  const rule = sourceRules.find((r) => r.meta.id === "KAEV-SEC-001");
  expect(await rule?.run(c)).toEqual([
    expect.objectContaining({
      file: "webapp/config.json",
      line: 2,
      column: 13,
      evidence: "[REDACTED credential literal]",
    }),
  ]);
});
it("reports exact AST line and column", async () => {
  const f = await sourceRules
    .find((r) => r.meta.id === "KAEV-SEC-004")
    ?.run(context("\n  eval(code);"));
  expect(f?.[0]).toMatchObject({ line: 2, column: 3 });
});
it("scopes stable IDs to flexibility-enabled freestyle apps", async () => {
  const rule = projectRules.find((r) => r.meta.id === "KAEV-UI5-001");
  const c = context("", {
    "webapp/Main.view.xml":
      '<mvc:View xmlns:mvc="sap.ui.core.mvc" xmlns="sap.m"><Button text="Go"/><Button id="save"/></mvc:View>',
  });
  expect(rule && (await runRules([rule], c)).findings).toEqual([]);
  c.project.flexibility = true;
  expect(await rule?.run(c)).toHaveLength(1);
});
it("accepts explicitly sanitized UI5 HTML controls", async () => {
  const rule = sourceRules.find((r) => r.meta.id === "KAEV-SEC-003");
  expect(
    await rule?.run(context("new sap.ui.core.HTML({content: input, sanitizeContent: true});")),
  ).toEqual([]);
});
