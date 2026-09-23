import { findNodeAtLocation, type Node as JsonNode } from "jsonc-parser";
import { credentialPattern, plausibleSecret, secretName } from "../analysis/secrets.js";
import { at, object } from "../analysis/workspace.js";
import type { RuleContext } from "../core/rules.js";
import type { Finding } from "../core/types.js";

export function structuredSecrets(c: RuleContext): Partial<Finding>[] {
  const found: Partial<Finding>[] = [];
  for (const [file, tree] of c.workspace.json) {
    const visit = (node: JsonNode): void => {
      if (node.type === "string" && typeof node.value === "string") {
        const parent = node.parent;
        const key: unknown =
          parent?.type === "property" && parent.children?.[1] === node
            ? parent.children[0]?.value
            : undefined;
        if (
          credentialPattern(node.value) ||
          (typeof key === "string" && secretName(key) && plausibleSecret(node.value))
        )
          found.push({
            file,
            ...c.workspace.location(file, node.offset),
            evidence: "[REDACTED credential literal]",
          });
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(tree);
  }
  return found;
}

export function insecureHttp(value: string): boolean {
  try {
    const u = new URL(value);
    return (
      u.protocol === "http:" &&
      !["localhost", "[::1]", "::1"].includes(u.hostname) &&
      !/^127\./.test(u.hostname) &&
      !u.hostname.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}

export function structuredEndpoints(c: RuleContext): Partial<Finding>[] {
  const found: Partial<Finding>[] = [];
  for (const root of c.project.sourceRoots) {
    const file = root === "." ? "manifest.json" : `${root}/manifest.json`;
    const manifest = c.workspace.get(file);
    const tree = c.workspace.json.get(file);
    for (const [name, value] of Object.entries(object(at(manifest, "sap.app", "dataSources")))) {
      const uri = at(value, "uri");
      if (at(value, "type") !== "OData" || typeof uri !== "string" || !insecureHttp(uri)) continue;
      const node = tree && findNodeAtLocation(tree, ["sap.app", "dataSources", name, "uri"]);
      found.push({
        file,
        ...(node ? c.workspace.location(file, node.offset) : {}),
        message: "An OData data source uses non-local HTTP.",
      });
    }
  }
  return found;
}
