import ts from "typescript";
import type { ProjectContext } from "../core/types.js";
export function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  const pending: ts.Node[] = [node];
  while (pending.length) {
    const current = pending.pop();
    if (!current) continue;
    visit(current);
    const children: ts.Node[] = [];
    ts.forEachChild(current, (child) => {
      children.push(child);
    });
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child) pending.push(child);
    }
  }
}
export function literal(node: ts.Node | undefined): string | undefined {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;
}
export function property(node: ts.Node | undefined, key: string): ts.Expression | undefined {
  if (!node || !ts.isObjectLiteralExpression(node)) return;
  for (const p of node.properties)
    if (
      ts.isPropertyAssignment(p) &&
      (ts.isIdentifier(p.name) ? p.name.text : literal(p.name)) === key
    )
      return p.initializer;
}
export function method(node: ts.Node): string | undefined {
  return ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
    ? node.expression.name.text
    : undefined;
}
export function imported(node: ts.Node, module: string): boolean {
  const source = node.getSourceFile();
  let found = false;
  walk(source, (n) => {
    if (
      ts.isImportDeclaration(n) &&
      literal(n.moduleSpecifier) === module &&
      n.importClause?.name?.text === node.getText()
    )
      found = true;
    if (ts.isCallExpression(n) && n.expression.getText(source) === "sap.ui.define") {
      const deps = n.arguments[0];
      const factory = n.arguments[1];
      if (
        deps &&
        ts.isArrayLiteralExpression(deps) &&
        factory &&
        (ts.isFunctionExpression(factory) || ts.isArrowFunction(factory))
      ) {
        const index = deps.elements.findIndex((e) => literal(e) === module);
        if (index >= 0 && factory.parameters[index]?.name.getText(source) === node.getText(source))
          found = true;
      }
    }
  });
  return found;
}
// Resolve only unambiguous, preceding lexical declarations; no cross-function guessing.
export function initializer(identifier: ts.Identifier): ts.Expression | undefined {
  let scope: ts.Node | undefined = identifier.parent;
  while (scope) {
    if (ts.isBlock(scope) || ts.isSourceFile(scope) || ts.isFunctionLike(scope)) {
      const matches: ts.VariableDeclaration[] = [];
      const scan = (n: ts.Node): void => {
        if (n !== scope && (ts.isFunctionLike(n) || ts.isBlock(n))) return;
        if (
          ts.isVariableDeclaration(n) &&
          ts.isIdentifier(n.name) &&
          n.name.text === identifier.text
        )
          matches.push(n);
        ts.forEachChild(n, scan);
      };
      scan(scope);
      if (matches.length) {
        let assigned = false;
        walk(scope, (n) => {
          if (
            ts.isBinaryExpression(n) &&
            n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
            n.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
            ts.isIdentifier(n.left) &&
            n.left.text === identifier.text
          )
            assigned = true;
        });
        return !assigned && matches.length === 1 && (matches[0]?.pos ?? Infinity) < identifier.pos
          ? matches[0]?.initializer
          : undefined;
      }
      if (
        ts.isFunctionLike(scope) &&
        scope.parameters.some((p) => p.name.getText() === identifier.text)
      )
        return;
    }
    scope = scope.parent;
  }
}
export function modelVersion(
  node: ts.Expression,
  project: ProjectContext,
  depth = 0,
): "v2" | "v4" | undefined {
  if (depth > 6) return;
  if (ts.isIdentifier(node)) {
    const init = initializer(node);
    return init ? modelVersion(init, project, depth + 1) : undefined;
  }
  if (ts.isNewExpression(node)) {
    if (
      imported(node.expression, "sap/ui/model/odata/v2/ODataModel") ||
      node.expression.getText() === "sap.ui.model.odata.v2.ODataModel"
    )
      return "v2";
    if (
      imported(node.expression, "sap/ui/model/odata/v4/ODataModel") ||
      node.expression.getText() === "sap.ui.model.odata.v4.ODataModel"
    )
      return "v4";
  }
  if (
    ts.isCallExpression(node) &&
    method(node) === "getModel" &&
    ts.isPropertyAccessExpression(node.expression)
  ) {
    const receiver = node.expression.expression.getText();
    if (!["this", "this.getView()", "this.getOwnerComponent()"].includes(receiver)) return;
    const name = node.arguments.length ? literal(node.arguments[0]) : "";
    if (name !== undefined) return project.models[name];
  }
}
export function odataCollection(node: ts.Expression, project: ProjectContext, depth = 0): boolean {
  if (depth > 6) return false;
  if (ts.isIdentifier(node)) {
    const init = initializer(node);
    return !!init && odataCollection(init, project, depth + 1);
  }
  if (
    ts.isCallExpression(node) &&
    method(node) === "getProperty" &&
    ts.isPropertyAccessExpression(node.expression)
  )
    return (
      modelVersion(node.expression.expression, project) === "v2" &&
      (literal(node.arguments[0])?.startsWith("/") ?? false)
    );
  if (
    !ts.isPropertyAccessExpression(node) ||
    node.name.text !== "results" ||
    !ts.isIdentifier(node.expression)
  )
    return false;
  let parent: ts.Node | undefined = node.parent;
  while (parent && !ts.isFunctionLike(parent)) parent = parent.parent;
  if (
    !parent ||
    !ts.isFunctionLike(parent) ||
    parent.parameters[0]?.name.getText() !== node.expression.text
  )
    return false;
  const holder = parent.parent;
  const success =
    (ts.isPropertyAssignment(holder) && holder.name.getText() === "success") ||
    (ts.isMethodDeclaration(parent) && parent.name.getText() === "success");
  const options = ts.isMethodDeclaration(parent) ? parent.parent : holder.parent;
  if (!success || !ts.isObjectLiteralExpression(options) || !ts.isCallExpression(options.parent))
    return false;
  const read = options.parent;
  return (
    method(read) === "read" &&
    ts.isPropertyAccessExpression(read.expression) &&
    modelVersion(read.expression.expression, project) === "v2"
  );
}
export interface NetworkCall {
  url: string;
  method: string;
}
export function network(node: ts.Node): NetworkCall | undefined {
  if (!ts.isCallExpression(node)) return;
  const name = node.expression.getText();
  if (name === "fetch" || name === "window.fetch") {
    const url = literal(node.arguments[0]);
    if (url)
      return {
        url,
        method: (literal(property(node.arguments[1], "method")) ?? "GET").toUpperCase(),
      };
  }
  if (name === "jQuery.ajax" || name === "$.ajax") {
    const url = literal(property(node.arguments[0], "url"));
    if (url)
      return {
        url,
        method: (
          literal(property(node.arguments[0], "method")) ??
          literal(property(node.arguments[0], "type")) ??
          "GET"
        ).toUpperCase(),
      };
  }
  if (
    method(node) === "open" &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression)
  ) {
    const init = initializer(node.expression.expression);
    const url = literal(node.arguments[1]);
    if (init && ts.isNewExpression(init) && init.expression.getText() === "XMLHttpRequest" && url)
      return { url, method: (literal(node.arguments[0]) ?? "GET").toUpperCase() };
  }
}
export function isOdataUrl(url: string, p: ProjectContext): boolean {
  return (
    /\/sap\/opu\/odata(?:4)?\//i.test(url) ||
    p.services.some(
      (s) => s !== "/" && (url === s || url.startsWith(s.endsWith("/") ? s : `${s}/`)),
    )
  );
}
