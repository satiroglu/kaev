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
  [
    "KAEV-SEC-010",
    '$.ajax({ url: "/api", async: false });',
    '$.ajax({ url: "/api", async: true });',
  ],
  ["KAEV-UI5-002", 'sap.ui.getCore().byId("btn");', 'this.byId("btn");'],
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

it("detects synchronous network calls across jQuery, XHR and aliased options", async () => {
  const rule = sourceRules.find((r) => r.meta.id === "KAEV-SEC-010");
  expect(rule).toBeDefined();

  // jQuery.ajax with async: false
  expect(await rule?.run(context('jQuery.ajax({ url: "/api", async: false });'))).toHaveLength(1);

  // XMLHttpRequest.open with false third argument
  expect(
    await rule?.run(context('const xhr = new XMLHttpRequest(); xhr.open("POST", "/data", false);')),
  ).toHaveLength(1);

  // Aliased options object
  expect(
    await rule?.run(context('const opts = { async: false, url: "/api" }; $.ajax(opts);')),
  ).toHaveLength(1);

  // Legacy/V2 OData read with an explicitly synchronous request
  expect(
    await rule?.run(
      context(
        'import ODataModel from "sap/ui/model/odata/ODataModel"; const model = new ODataModel("/service"); model.read("/Orders", { async: false });',
      ),
    ),
  ).toHaveLength(1);

  // Counterexamples
  expect(await rule?.run(context("otherService.ajax({ async: false });"))).toEqual([]);
  expect(await rule?.run(context('modalDialog.open("GET", "/url", false);'))).toEqual([]);
  expect(await rule?.run(context('xhr.open("GET", "/url", true);'))).toEqual([]);
  expect(await rule?.run(context('xhr.open("GET", "/url");'))).toEqual([]);
  expect(
    await rule?.run(
      context(
        'import ODataModel from "sap/ui/model/odata/ODataModel"; new ODataModel("/service", false);',
      ),
    ),
  ).toEqual([]);
});

it("detects global sap.ui.getCore() access", async () => {
  const rule = sourceRules.find((r) => r.meta.id === "KAEV-UI5-002");
  expect(rule).toBeDefined();

  expect(await rule?.run(context('sap.ui.getCore().applyTheme("sap_horizon");'))).toHaveLength(1);
  expect(await rule?.run(context("const core = sap.ui.getCore(); core.byId('app');"))).toHaveLength(
    1,
  );
  expect(await rule?.run(context("this.getOwnerComponent().byId('app');"))).toEqual([]);
  expect(await rule?.run(context("customModule.getCore();"))).toEqual([]);
});

it("detects uncleaned event bus and router subscriptions in controllers", async () => {
  const rule = sourceRules.find((r) => r.meta.id === "KAEV-LEAK-001");
  expect(rule).toBeDefined();

  // Missing unsubscribe in onExit
  const leakCode = `
    sap.ui.define(["sap/ui/core/mvc/Controller"], function(Controller) {
      return Controller.extend("my.app.controller.Main", {
        onInit: function() {
          sap.ui.getCore().getEventBus().subscribe("channel", "event", this.onEvent, this);
        }
      });
    });
  `;
  expect(await rule?.run(context(leakCode))).toHaveLength(1);

  // Router attachRouteMatched with missing detach
  const routerLeak = `
    sap.ui.define(["sap/ui/core/mvc/Controller"], function(Controller) {
      return Controller.extend("my.app.controller.Main", {
        onInit: function() {
          this.getRouter().attachRouteMatched(this.onRoute, this);
        }
      });
    });
  `;
  expect(await rule?.run(context(routerLeak))).toHaveLength(1);

  // Function identity mismatch (.bind(this) leak)
  const bindMismatchLeak = `
    sap.ui.define(["sap/ui/core/mvc/Controller"], function(Controller) {
      return Controller.extend("my.app.controller.Main", {
        onInit: function() {
          this.getRouter().attachRouteMatched(this.onRoute.bind(this), this);
        },
        onExit: function() {
          this.getRouter().detachRouteMatched(this.onRoute.bind(this), this);
        }
      });
    });
  `;
  expect(await rule?.run(context(bindMismatchLeak))).toHaveLength(1);

  // Properly cleaned up in onExit (negative case)
  const cleanCode = `
    sap.ui.define(["sap/ui/core/mvc/Controller"], function(Controller) {
      return Controller.extend("my.app.controller.Main", {
        onInit: function() {
          this.getRouter().attachRouteMatched(this.onRoute, this);
        },
        onExit: function() {
          this.getRouter().detachRouteMatched(this.onRoute, this);
        }
      });
    });
  `;
  expect(await rule?.run(context(cleanCode))).toEqual([]);

  // An unrelated detach call must not hide the leaking subscription
  const mismatchedCleanup = `
    Controller.extend("Controller", {
      onInit() { this.getRouter().attachRouteMatched(this.onRoute, this); },
      onExit() { this.getOtherRouter().detachRouteMatched(this.onOtherRoute, this); }
    });
  `;
  expect(await rule?.run(context(mismatchedCleanup))).toHaveLength(1);
});

it("detects uncleared intervals in controller instance properties", async () => {
  const rule = sourceRules.find((r) => r.meta.id === "KAEV-LEAK-002");
  expect(rule).toBeDefined();

  // Uncleared interval in this._timer
  const leakCode = `
    sap.ui.define(["sap/ui/core/mvc/Controller"], function(Controller) {
      return Controller.extend("my.app.controller.Main", {
        onInit: function() {
          this._timer = setInterval(function() {}, 1000);
        }
      });
    });
  `;
  expect(await rule?.run(context(leakCode))).toHaveLength(1);

  // Cleared interval in onExit (safe)
  const cleanCode = `
    sap.ui.define(["sap/ui/core/mvc/Controller"], function(Controller) {
      return Controller.extend("my.app.controller.Main", {
        onInit: function() {
          this._timer = setInterval(function() {}, 1000);
        },
        onExit: function() {
          clearInterval(this._timer);
        }
      });
    });
  `;
  expect(await rule?.run(context(cleanCode))).toEqual([]);

  // setTimeout is not flagged as an interval leak
  const timeoutCode = `
    sap.ui.define(["sap/ui/core/mvc/Controller"], function(Controller) {
      return Controller.extend("my.app.controller.Main", {
        onInit: function() {
          this._to = setTimeout(function() {}, 500);
        }
      });
    });
  `;
  expect(await rule?.run(context(timeoutCode))).toEqual([]);
});

it("detects hardcoded user-facing XML text while ignoring bindings, numbers and icons", async () => {
  const rule = projectRules.find((r) => r.meta.id === "KAEV-I18N-001");
  expect(rule).toBeDefined();

  const positiveXml = `
    <mvc:View xmlns:mvc="sap.ui.core.mvc" xmlns="sap.m">
      <Button text="Submit Order"/>
      <Text text="Order Summary Details"/>
      <Title text="Dashboard Overview"/>
      <Label text="Customer Identification"/>
    </mvc:View>
  `;
  const posContext = context("", { "webapp/view/Main.view.xml": positiveXml });
  const findings = await rule?.run(posContext);
  expect(findings).toHaveLength(4);
  expect(JSON.stringify(findings)).not.toContain("Submit Order");

  const negativeXml = `
    <mvc:View xmlns:mvc="sap.ui.core.mvc" xmlns="sap.m">
      <Button text="{i18n>submitOrder}"/>
      <Text text="{orderModel>/summary}"/>
      <Title text="{= \${status} === 'A' ? 'Active' : 'Inactive' }"/>
      <Label text="12345"/>
      <Button text="   "/>
      <Button text=""/>
      <Button text="sap-icon://accept"/>
    </mvc:View>
  `;
  const negContext = context("", { "webapp/view/Main.view.xml": negativeXml });
  expect(await rule?.run(negContext)).toEqual([]);

  // Non-view/fragment XML files are ignored
  const otherXmlContext = context("", { "webapp/config.xml": positiveXml });
  expect(await rule?.run(otherXmlContext)).toEqual([]);
});

it("distinguishes OData V4 requestContexts collection flow from binding filters", async () => {
  const rule = sourceRules.find((r) => r.meta.id === "KAEV-ODATA-001");
  expect(rule).toBeDefined();

  // V4 requestContexts collection local filter
  const v4LocalFilter = `
    const model = this.getOwnerComponent().getModel();
    const contexts = await model.bindList("/Orders").requestContexts();
    contexts.filter(x => x.getProperty("status") === "Open");
  `;
  expect(await rule?.run(context(v4LocalFilter))).toHaveLength(1);

  // V4 binding with binding-level filters (not flagged)
  const v4BindingFilter = `
    const model = this.getOwnerComponent().getModel();
    const binding = model.bindList("/Orders", undefined, [new Filter("status", "EQ", "Open")]);
  `;
  expect(await rule?.run(context(v4BindingFilter))).toEqual([]);
});
