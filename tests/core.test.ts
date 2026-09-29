import path from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";
import { getPermissionFlag } from "../src/adapters/ui5-linter/index.js";
import {
  initializer,
  resolveConstantString,
  resolveStringInfo,
  unwrap,
  walk,
} from "../src/analysis/ast.js";
import { secretName } from "../src/analysis/secrets.js";
import { Workspace } from "../src/analysis/workspace.js";
import { sanitizeDebugError } from "../src/cli/debug.js";
import { evaluateRuntimeVersion } from "../src/cli/runtime.js";
import { createRedactor, processFindings } from "../src/core/processing.js";
import { applicability, type Rule, runRules } from "../src/core/rules.js";
import { scoring } from "../src/core/scoring.js";
import { detectProject } from "../src/detectors/project.js";
import {
  normalizeExternalFindingPath,
  normalizeWorkspacePath,
  resolveWithinRoot,
  validateRootFileName,
  validateSourceRoot,
} from "../src/filesystem/paths.js";
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
  expect(f.map((x) => x.ruleId)).toEqual(["KAEV-SEC-003"]);
  const first = f[0];
  if (!first) throw new Error("missing");
  expect(scoring.score([{ ...first, severity: "critical", confidence: "high" }])).toBe(70);
  expect(scoring.score([{ ...first, kind: "modernization" }])).toBeGreaterThan(scoring.score(f));
});

it("evaluates runtime version boundaries correctly", () => {
  expect(evaluateRuntimeVersion("18.20.0").supported).toBe(false);
  expect(evaluateRuntimeVersion("20.10.0").supported).toBe(false);
  expect(evaluateRuntimeVersion("20.11.0")).toMatchObject({ supported: true, deprecated: true });
  expect(evaluateRuntimeVersion("22.11.0").supported).toBe(true);
  expect(evaluateRuntimeVersion("22.12.0")).toMatchObject({ supported: true, deprecated: false });
  expect(evaluateRuntimeVersion("24.0.0")).toMatchObject({ supported: true, deprecated: false });
  expect(evaluateRuntimeVersion("25.0.0").supported).toBe(false);
  expect(evaluateRuntimeVersion("26.0.0").supported).toBe(false);
});

it("selects appropriate permission flag by Node major version", () => {
  expect(getPermissionFlag(20)).toBe("--experimental-permission");
  expect(getPermissionFlag(22)).toBe("--experimental-permission");
  expect(getPermissionFlag(24)).toBe("--permission");
  expect(getPermissionFlag(25)).toBe("--permission");
});

it("normalizes workspace paths to POSIX separators and handles edge cases", () => {
  expect(normalizeWorkspacePath("webapp/Component.js")).toBe("webapp/Component.js");
  expect(normalizeWorkspacePath("webapp\\view\\Main.view.xml")).toBe("webapp/view/Main.view.xml");
  expect(normalizeWorkspacePath("./webapp/model/models.js")).toBe("webapp/model/models.js");
  expect(normalizeWorkspacePath(".\\webapp\\model\\models.js")).toBe("webapp/model/models.js");
  expect(normalizeWorkspacePath("path/with\0/null")).toBe("");
});

it("enforces filesystem containment within root", () => {
  const root = path.resolve("/fake/project/root");
  expect(resolveWithinRoot(root, "webapp/Main.view.xml")).toBe(
    path.resolve(root, "webapp/Main.view.xml"),
  );
  expect(resolveWithinRoot(root, "webapp/sub/file.js")).toBe(
    path.resolve(root, "webapp/sub/file.js"),
  );
  // ..safe/file is not directory traversal escaping root
  expect(resolveWithinRoot(root, "..safe/file.js")).toBe(path.resolve(root, "..safe/file.js"));
  // Escaping paths
  expect(resolveWithinRoot(root, "../outside.js")).toBeNull();
  expect(resolveWithinRoot(root, "webapp/../../outside.js")).toBeNull();
  // Absolute paths
  expect(resolveWithinRoot(root, "/etc/passwd")).toBeNull();
  // Drive letter paths (Windows)
  expect(resolveWithinRoot(root, "C:\\escaped\\file.js")).toBeNull();
  expect(resolveWithinRoot(root, "D:/escaped/file.js")).toBeNull();
  // UNC paths
  expect(resolveWithinRoot(root, "\\\\server\\share\\file.js")).toBeNull();
  expect(resolveWithinRoot(root, "//server/share/file.js")).toBeNull();
  // NUL byte
  expect(resolveWithinRoot(root, "webapp/\0evil.js")).toBeNull();
});

it("validates root-level config and baseline file names", () => {
  expect(validateRootFileName("config.json")).toBe(true);
  expect(validateRootFileName(".kaevrc.json")).toBe(true);
  expect(validateRootFileName("./.kaev-baseline.json")).toBe(true);
  expect(validateRootFileName("sub/config.json")).toBe(false);
  expect(validateRootFileName("sub\\config.json")).toBe(false);
  expect(validateRootFileName("../outside.json")).toBe(false);
  expect(validateRootFileName("C:\\config.json")).toBe(false);
  expect(validateRootFileName("\\\\share\\config.json")).toBe(false);
  expect(validateRootFileName("/config.json")).toBe(false);
  expect(validateRootFileName("config\0.json")).toBe(false);
});

it("normalizes external tool finding paths to workspace identifiers", () => {
  const root = path.resolve("/my/project");
  expect(normalizeExternalFindingPath(root, path.join(root, "webapp/Component.js"))).toBe(
    "webapp/Component.js",
  );
  expect(normalizeExternalFindingPath(root, path.join(root, "sub", "file.js"))).toBe("sub/file.js");
  expect(normalizeExternalFindingPath(root, path.resolve("/other/project/file.js"))).toBeNull();
  expect(normalizeExternalFindingPath(root, "webapp/\0invalid")).toBeNull();
});

it("validates manifest and config source roots", () => {
  expect(validateSourceRoot("webapp")).toBe(true);
  expect(validateSourceRoot("client/app")).toBe(true);
  expect(validateSourceRoot("src\\ui5")).toBe(true);
  expect(validateSourceRoot("../outside")).toBe(false);
  expect(validateSourceRoot("/absolute/root")).toBe(false);
  expect(validateSourceRoot("C:\\root")).toBe(false);
});

it("normalizes Windows separators in configured source roots", () => {
  const workspace = new Workspace([
    {
      path: "ui5.yaml",
      text: 'specVersion: "3.0"\ntype: application\nresources:\n  configuration:\n    paths:\n      webapp: client\\app\n',
      origin: "application",
    },
    {
      path: "client/app/Component.js",
      text: "sap.ui.define([], () => {});",
      origin: "application",
    },
  ]);
  const project = detectProject("/project", workspace);
  expect(project.sourceRoots).toEqual(["client/app"]);
  expect(project.language).toBe("javascript");
});

it("unwraps syntactic wrappers safely with depth bounds", () => {
  const source = ts.createSourceFile(
    "test.ts",
    "async function test() { const x = (((await (value as any)!)) satisfies any); }",
    ts.ScriptTarget.Latest,
    true,
  );
  let id: ts.Node | undefined;
  walk(source, (node) => {
    if (ts.isIdentifier(node) && node.text === "value") id = node;
  });
  let init: ts.Node | undefined;
  walk(source, (node) => {
    if (ts.isVariableDeclaration(node) && node.initializer) init = node.initializer;
  });
  expect(init).toBeDefined();
  const unwrapped = unwrap(init);
  expect(unwrapped).toBe(id);
});

it("resolves constant strings and dynamic templates safely", () => {
  const code = `
    const plain = "hello";
    const templateNoSub = \`world\`;
    const staticConcat = "foo" + "bar";
    const staticTemplate = \`base_\${"part"}\`;
    const dynamicTemplate = \`prefix_\${dynamicVar}_suffix\`;
  `;
  const sf = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
  const vars: Record<string, ts.Expression> = {};
  walk(sf, (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      vars[node.name.text] = node.initializer;
    }
  });

  expect(resolveConstantString(vars.plain)).toBe("hello");
  expect(resolveConstantString(vars.templateNoSub)).toBe("world");
  expect(resolveConstantString(vars.staticConcat)).toBe("foobar");
  expect(resolveConstantString(vars.staticTemplate)).toBe("base_part");
  expect(resolveConstantString(vars.dynamicTemplate)).toBeUndefined();

  const info = resolveStringInfo(vars.dynamicTemplate);
  expect(info).toMatchObject({
    hasDynamic: true,
    prefix: "prefix_",
    suffix: "_suffix",
  });
});

it("resolves reaching variable declarations with lexical scope, shadowing and cycle protection", () => {
  const code = `
    const a = "initial_a";
    const b = a;
    const c = b;

    function scope() {
      const a = "shadowed_a";
      const use1 = a;
    }

    let reassigned = "first";
    const useBefore = reassigned;
    reassigned = "second";
    const useAfter = reassigned;

    let cycleX = cycleY;
    let cycleY = cycleX;
  `;
  const sf = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
  const findInit = (varName: string) => {
    let result: ts.Node | undefined;
    walk(sf, (node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === varName &&
        node.initializer &&
        ts.isIdentifier(node.initializer)
      ) {
        result = initializer(node.initializer);
      }
    });
    return result;
  };

  const cInit = findInit("c");
  expect(cInit && ts.isStringLiteral(cInit) ? cInit.text : undefined).toBe("initial_a");

  const beforeInit = findInit("useBefore");
  expect(beforeInit && ts.isStringLiteral(beforeInit) ? beforeInit.text : undefined).toBe("first");

  const afterInit = findInit("useAfter");
  expect(afterInit && ts.isStringLiteral(afterInit) ? afterInit.text : undefined).toBe("second");

  expect(() => findInit("cycleX")).not.toThrow();
});

it("processes synthetic large source file without performance regression", () => {
  const statements: string[] = ['const rootVal = "root";'];
  for (let i = 0; i < 1000; i++) {
    statements.push(`const var_${i} = var_${Math.max(0, i - 1)};`);
  }
  const largeCode = statements.join("\n");
  const sf = ts.createSourceFile("large.ts", largeCode, ts.ScriptTarget.Latest, true);
  const start = Date.now();
  let count = 0;
  walk(sf, (node) => {
    if (ts.isVariableDeclaration(node)) count++;
  });
  const duration = Date.now() - start;
  expect(count).toBe(1001);
  expect(duration).toBeLessThan(1000);
});

it("sanitizes debug stack traces completely", () => {
  const secretKey = "sk_live_9Az7bQ2mX4pR8tUv";
  const fakeRoot = "/Users/test/projects/secret-app";
  const rawError = new Error(
    `Failed with ${secretKey} at ${fakeRoot}/webapp/Component.js\u202E\x00\x08`,
  );
  const sanitized = sanitizeDebugError(rawError, fakeRoot);

  expect(sanitized).not.toContain(secretKey);
  expect(sanitized).toContain("[REDACTED]");
  expect(sanitized).not.toContain(fakeRoot);
  expect(sanitized).toContain("<project-root>");
  expect(sanitized).not.toContain("\u202E");
  expect(sanitized).not.toContain("\x00");
  expect(sanitized).not.toContain("\x08");
});
