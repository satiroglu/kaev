import { Workspace } from "../src/analysis/workspace.js";
import type { RuleContext } from "../src/core/rules.js";
import { detectProject } from "../src/detectors/project.js";
export function context(code = "", extra: Record<string, string> = {}): RuleContext {
  const files = {
    "ui5.yaml":
      'specVersion: "3.0"\ntype: application\nmetadata:\n  name: test.app\nframework:\n  name: SAPUI5\n  version: "1.120.21"\n',
    "webapp/manifest.json": JSON.stringify({
      "sap.app": {
        id: "test.app",
        type: "application",
        dataSources: {
          main: {
            type: "OData",
            uri: "/sap/opu/odata/sap/TEST/",
            settings: { odataVersion: "2.0" },
          },
        },
      },
      "sap.ui5": { rootView: "test.app.view.Main", models: { "": { dataSource: "main" } } },
    }),
    "webapp/controller/Main.controller.js": code,
    ...extra,
  };
  const workspace = new Workspace(
    Object.entries(files).map(([path, text]) => ({ path, text, origin: "application" as const })),
  );
  return { project: detectProject("/project", workspace), workspace };
}
