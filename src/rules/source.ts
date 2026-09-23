import ts from "typescript";
import {
  imported,
  isOdataUrl,
  literal,
  method,
  modelVersion,
  network,
  odataCollection,
  property,
  walk,
} from "../analysis/ast.js";
import { plausibleSecret, secretName } from "../analysis/secrets.js";
import type { Rule, RuleContext } from "../core/rules.js";
import type { Finding } from "../core/types.js";
import { type Definition, define } from "./catalog.js";
import { insecureHttp, structuredEndpoints, structuredSecrets } from "./documents.js";

function sourceRule(
  d: Definition,
  predicate: (node: ts.Node, c: RuleContext) => Partial<Finding> | undefined,
  applicability?: Rule["meta"]["applicability"],
  structured?: (c: RuleContext) => Partial<Finding>[],
): Rule {
  return define(
    d,
    (c, finding) => {
      const result: Finding[] = [];
      for (const [file, ast] of c.workspace.ast) {
        if (!c.project.sourceRoots.some((r) => r === "." || file.startsWith(`${r}/`))) continue;
        walk(ast, (node) => {
          const match = predicate(node, c);
          if (match) {
            const pos = ast.getLineAndCharacterOfPosition(node.getStart(ast));
            result.push(finding({ file, line: pos.line + 1, column: pos.character + 1, ...match }));
          }
        });
      }
      return result.concat((structured?.(c) ?? []).map(finding));
    },
    { requiresUi5: true, ...applicability },
  );
}
const recommendationOdata =
  "Consider UI5 list binding filters/sorters or service-side $filter/$orderby. Small intentional local datasets are valid exceptions.";
export const sourceRules: Rule[] = [
  ...(["filter", "sort"] as const).map((operation, i) =>
    sourceRule(
      {
        id: `KAEV-ODATA-00${i + 1}`,
        title: `Potential client-side ${operation === "filter" ? "filtering" : "sorting"} of OData results`,
        category: "odata",
        severity: "medium",
        basis: "derived",
        references: ["odata"],
        why: "Processing retrieved collections locally may transfer unnecessary data or operate on an incomplete collection.",
        recommendation: recommendationOdata,
      },
      (n, c) =>
        ts.isCallExpression(n) &&
        method(n) === operation &&
        ts.isPropertyAccessExpression(n.expression) &&
        odataCollection(n.expression.expression, c.project)
          ? { confidence: "medium" }
          : undefined,
      { odataVersions: ["v2"] },
    ),
  ),
  sourceRule(
    {
      id: "KAEV-ODATA-003",
      title: "Unusually large model size limit",
      category: "odata",
      severity: "medium",
      basis: "heuristic",
      why: "A size limit above 10,000 may increase binding, memory and rendering costs; it does not itself fetch all records.",
      recommendation: "Prefer paging and review the actual binding workload.",
    },
    (n, c) =>
      ts.isCallExpression(n) &&
      method(n) === "setSizeLimit" &&
      ts.isPropertyAccessExpression(n.expression) &&
      modelVersion(n.expression.expression, c.project) &&
      n.arguments[0] &&
      ts.isNumericLiteral(n.arguments[0]) &&
      Number(n.arguments[0].text) > 10000
        ? { confidence: "medium" }
        : undefined,
    { odataVersions: ["v2", "v4"] },
  ),
  sourceRule(
    {
      id: "KAEV-ARCH-001",
      title: "Direct OData networking",
      category: "architecture",
      severity: "medium",
      basis: "derived",
      references: ["odata"],
      why: "Direct requests bypass UI5 model binding, batching and lifecycle integration.",
      recommendation:
        "Consider the configured ODataModel, or document intentional manual networking.",
    },
    (n, c) => {
      const call = network(n);
      return call && isOdataUrl(call.url, c.project) ? {} : undefined;
    },
  ),
  sourceRule(
    {
      id: "KAEV-ARCH-002",
      title: "Direct DOM mutation in UI5 controller",
      category: "architecture",
      severity: "low",
      basis: "heuristic",
      why: "DOM changes can be lost when UI5 rerenders controls.",
      recommendation:
        "Prefer control properties or a documented custom-control rendering boundary.",
    },
    (n) =>
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(n.left) &&
      ["innerHTML", "outerHTML"].includes(n.left.name.text) &&
      /(?:\.controller\.[jt]s|Component\.[jt]s)$/.test(n.getSourceFile().fileName)
        ? { confidence: "medium" }
        : undefined,
  ),
  sourceRule(
    {
      id: "KAEV-PERF-001",
      title: "Model refresh inside a loop",
      category: "performance",
      severity: "medium",
      basis: "heuristic",
      why: "Repeated refreshes can trigger redundant network requests and binding work.",
      recommendation: "Review whether one refresh after the loop is sufficient.",
    },
    (n, c) => {
      if (
        !ts.isCallExpression(n) ||
        method(n) !== "refresh" ||
        !ts.isPropertyAccessExpression(n.expression) ||
        !modelVersion(n.expression.expression, c.project)
      )
        return;
      let p: ts.Node | undefined = n.parent;
      while (p && !ts.isFunctionLike(p)) {
        if (
          ts.isForStatement(p) ||
          ts.isForOfStatement(p) ||
          ts.isForInStatement(p) ||
          ts.isWhileStatement(p) ||
          ts.isDoStatement(p)
        )
          return { confidence: "medium" };
        p = p.parent;
      }
    },
  ),
  sourceRule(
    {
      id: "KAEV-SEC-001",
      title: "Potential hardcoded credential",
      category: "security",
      severity: "critical",
      basis: "heuristic",
      why: "Credentials shipped in frontend code can be recovered by users.",
      recommendation:
        "Remove the credential, rotate it if real, and move authentication secrets to a trusted backend.",
    },
    (n) => {
      if ((ts.isVariableDeclaration(n) || ts.isPropertyAssignment(n)) && n.initializer) {
        const value = literal(n.initializer);
        const name = ts.isIdentifier(n.name) ? n.name.text : literal(n.name);
        if (value && name && secretName(name) && plausibleSecret(value))
          return { evidence: "[REDACTED credential literal]" };
      }
      if (
        ts.isStringLiteral(n) &&
        (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(n.text) ||
          /^Bearer\s+[A-Za-z0-9._~+/-]{20,}/.test(n.text))
      )
        return { evidence: "[REDACTED credential literal]" };
    },
    undefined,
    structuredSecrets,
  ),
  sourceRule(
    {
      id: "KAEV-SEC-002",
      title: "Sensitive browser storage",
      category: "security",
      severity: "high",
      basis: "heuristic",
      why: "Script-accessible storage exposes credentials to injected scripts.",
      recommendation: "Review authentication architecture and minimize browser-stored credentials.",
    },
    (n) =>
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === "setItem" &&
      /^(?:(?:window|globalThis)\.)?(?:localStorage|sessionStorage)$/.test(
        n.expression.expression.getText(),
      ) &&
      secretName(literal(n.arguments[0]) ?? "")
        ? {}
        : undefined,
  ),
  sourceRule(
    {
      id: "KAEV-SEC-003",
      title: "Dynamic HTML requires sanitization review",
      category: "security",
      severity: "high",
      basis: "heuristic",
      references: ["security"],
      why: "Dynamic HTML may execute attacker-controlled markup if its input is untrusted.",
      recommendation:
        "Prefer text/control APIs, or verify trusted sanitization before HTML insertion.",
    },
    (n) => {
      if (
        ts.isBinaryExpression(n) &&
        n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(n.left) &&
        ["innerHTML", "outerHTML"].includes(n.left.name.text) &&
        literal(n.right) === undefined
      )
        return { confidence: "medium" };
      if (
        ts.isNewExpression(n) &&
        (n.expression.getText() === "sap.ui.core.HTML" ||
          imported(n.expression, "sap/ui/core/HTML"))
      ) {
        const content = property(n.arguments?.[0], "content");
        const sanitized = property(n.arguments?.[0], "sanitizeContent");
        if (
          content &&
          literal(content) === undefined &&
          sanitized?.kind !== ts.SyntaxKind.TrueKeyword
        )
          return { confidence: "medium" };
      }
    },
  ),
  sourceRule(
    {
      id: "KAEV-SEC-004",
      title: "Dynamic code execution",
      category: "security",
      severity: "high",
      basis: "derived",
      references: ["security"],
      why: "Dynamic evaluation complicates CSP enforcement and can execute untrusted input.",
      recommendation: "Replace code strings with explicit functions or data parsing.",
    },
    (n) =>
      (ts.isCallExpression(n) && n.expression.getText() === "eval") ||
      (ts.isNewExpression(n) && n.expression.getText() === "Function")
        ? {}
        : undefined,
  ),
  sourceRule(
    {
      id: "KAEV-SEC-005",
      title: "Unencrypted backend endpoint",
      category: "security",
      severity: "high",
      basis: "heuristic",
      why: "HTTP transport can expose backend traffic to interception or modification.",
      recommendation: "Use HTTPS for non-local backend endpoints.",
    },
    (n) => {
      const call = network(n);
      return call && insecureHttp(call.url) ? {} : undefined;
    },
    undefined,
    structuredEndpoints,
  ),
  sourceRule(
    {
      id: "KAEV-SEC-006",
      title: "Sensitive value passed to logging",
      category: "security",
      severity: "high",
      basis: "heuristic",
      why: "Logs may expose authentication material to users or log collectors.",
      recommendation: "Remove sensitive values from logging and review existing log retention.",
    },
    (n) => {
      if (
        !ts.isCallExpression(n) ||
        !/^(?:console\.(?:log|info|warn|error|debug)|(?:Log|jQuery\.sap\.log)\.(?:info|warning|error|debug))$/.test(
          n.expression.getText(),
        )
      )
        return;
      let found = false;
      for (const arg of n.arguments)
        walk(arg, (a) => {
          if (ts.isIdentifier(a) && secretName(a.text)) found = true;
        });
      return found ? { confidence: "medium" } : undefined;
    },
  ),
  sourceRule(
    {
      id: "KAEV-SEC-007",
      title: "Client-side authorization-related logic",
      category: "security",
      severity: "high",
      basis: "heuristic",
      why: "UI visibility does not establish backend authorization.",
      recommendation:
        "Verify that the corresponding privileged operation is independently authorized by the backend.",
    },
    (n) => {
      if (!ts.isIfStatement(n)) return;
      let role = false;
      let ui = false;
      walk(n.expression, (a) => {
        if (
          ts.isIdentifier(a) &&
          /^(?:isAdmin|isAuthorized|hasRole|roles?|permissions?)$/i.test(a.text)
        )
          role = true;
      });
      walk(n.thenStatement, (a) => {
        if (
          ts.isCallExpression(a) &&
          ["setVisible", "setEnabled"].includes(method(a) ?? "") &&
          a.expression.getText().includes(".byId(")
        )
          ui = true;
      });
      return role && ui
        ? {
            confidence: "medium",
            message:
              "Client-side authorization-related logic detected. Verify backend authorization independently; no missing backend check has been established.",
          }
        : undefined;
    },
  ),
  sourceRule(
    {
      id: "KAEV-SEC-008",
      title: "Manual OData write requires CSRF review",
      category: "security",
      severity: "high",
      basis: "derived",
      references: ["odata"],
      why: "Manual writes require appropriate CSRF and request lifecycle handling; static analysis does not establish an exploitable vulnerability.",
      recommendation:
        "Verify CSRF handling and backend authorization, or use the configured ODataModel.",
    },
    (n, c) => {
      const call = network(n);
      return call &&
        isOdataUrl(call.url, c.project) &&
        ["POST", "PUT", "PATCH", "DELETE"].includes(call.method)
        ? { confidence: "medium" }
        : undefined;
    },
  ),
];
