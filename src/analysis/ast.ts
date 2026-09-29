import ts from "typescript";
import type { ProjectContext } from "../core/types.js";

/**
 * Traverses an AST depth-first using a non-recursive stack to prevent call-stack exhaustion.
 */
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

/**
 * Unwraps safe syntactic wrappers such as parentheses, await expressions,
 * type assertions, as expressions, non-null assertions, and satisfies expressions.
 */
export function unwrap(node: undefined, depth?: number): undefined;
export function unwrap(node: ts.Node, depth?: number): ts.Node;
export function unwrap(node: ts.Node | undefined, depth?: number): ts.Node | undefined;
export function unwrap(node: ts.Node | undefined, depth = 0): ts.Node | undefined {
  if (depth > 10 || !node) return node;

  if (ts.isParenthesizedExpression(node)) {
    return unwrap(node.expression, depth + 1);
  }
  if (ts.isAwaitExpression(node)) {
    return unwrap(node.expression, depth + 1);
  }
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "await" &&
    node.arguments.length === 1
  ) {
    const arg = node.arguments[0];
    if (arg) return unwrap(arg, depth + 1);
  }
  if (ts.isTypeAssertionExpression(node)) {
    return unwrap(node.expression, depth + 1);
  }
  if (ts.isAsExpression(node)) {
    return unwrap(node.expression, depth + 1);
  }
  if (ts.isNonNullExpression(node)) {
    return unwrap(node.expression, depth + 1);
  }
  if (ts.isSatisfiesExpression?.(node)) {
    return unwrap(node.expression, depth + 1);
  }

  return node;
}

/**
 * Basic string literal extraction without alias resolution (for backward compatibility).
 */
export function literal(node: ts.Node | undefined): string | undefined {
  if (!node) return undefined;
  const unwrapped = unwrap(node);
  return ts.isStringLiteral(unwrapped) || ts.isNoSubstitutionTemplateLiteral(unwrapped)
    ? unwrapped.text
    : undefined;
}

export interface StringInfo {
  value?: string;
  prefix?: string;
  suffix?: string;
  hasDynamic: boolean;
  parts: string[];
}

/**
 * Bounded constant string resolver that supports:
 * - String literals
 * - No-substitution template literals
 * - Fully static template expressions (with static expressions)
 * - Static binary string concatenations ("a" + "b")
 * - Identifier aliases resolved safely with cycle and depth guards
 */
export function resolveConstantString(
  node: ts.Node | undefined,
  depth = 0,
  visited = new Set<number>(),
): string | undefined {
  if (!node || depth > 8) return undefined;
  const target = unwrap(node);

  if (ts.isStringLiteral(target) || ts.isNoSubstitutionTemplateLiteral(target)) {
    return target.text;
  }

  if (ts.isTemplateExpression(target)) {
    let result = target.head.text;
    for (const span of target.templateSpans) {
      const exprVal = resolveConstantString(span.expression, depth + 1, visited);
      if (exprVal === undefined) return undefined; // Dynamic span, cannot manufacture fake string
      result += exprVal + span.literal.text;
    }
    return result;
  }

  if (ts.isBinaryExpression(target) && target.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = resolveConstantString(target.left, depth + 1, visited);
    const right = resolveConstantString(target.right, depth + 1, visited);
    if (left !== undefined && right !== undefined) {
      return left + right;
    }
    return undefined;
  }

  if (ts.isIdentifier(target)) {
    if (visited.has(target.pos)) return undefined;
    visited.add(target.pos);
    const init = initializer(target);
    return init ? resolveConstantString(init, depth + 1, visited) : undefined;
  }

  return undefined;
}

/**
 * Structured information resolver for string/template expressions.
 * Preserves static segments (prefix, suffix) for dynamic templates without manufacturing fake complete URLs.
 */
export function resolveStringInfo(
  node: ts.Node | undefined,
  depth = 0,
  visited = new Set<number>(),
): StringInfo | undefined {
  if (!node || depth > 8) return undefined;
  const target = unwrap(node);

  const constant = resolveConstantString(target, depth, visited);
  if (constant !== undefined) {
    return {
      value: constant,
      prefix: constant,
      suffix: constant,
      hasDynamic: false,
      parts: [constant],
    };
  }

  if (ts.isTemplateExpression(target)) {
    const prefix = target.head.text;
    const lastSpan = target.templateSpans[target.templateSpans.length - 1];
    const suffix = lastSpan ? lastSpan.literal.text : "";
    return {
      prefix,
      suffix,
      hasDynamic: true,
      parts: [prefix, suffix],
    };
  }

  if (ts.isBinaryExpression(target) && target.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = resolveStringInfo(target.left, depth + 1, visited);
    const right = resolveStringInfo(target.right, depth + 1, visited);
    return {
      prefix: left?.prefix,
      suffix: right?.suffix,
      hasDynamic: true,
      parts: [left?.prefix ?? "", right?.suffix ?? ""].filter(Boolean),
    };
  }

  return undefined;
}

/**
 * Retrieves a property initializer by name from an object literal (or safely resolved identifier).
 */
export function property(node: ts.Node | undefined, key: string): ts.Expression | undefined {
  if (!node) return;
  const target = unwrap(node);
  if (!ts.isObjectLiteralExpression(target)) {
    if (ts.isIdentifier(target)) {
      const init = initializer(target);
      if (init) return property(init, key);
    }
    return;
  }
  for (const p of target.properties) {
    if (
      ts.isPropertyAssignment(p) &&
      (ts.isIdentifier(p.name) ? p.name.text : literal(p.name)) === key
    ) {
      return unwrap(p.initializer) as ts.Expression;
    }
  }
}

/**
 * Returns the method name of a call expression if invoked as a property access.
 */
export function method(node: ts.Node): string | undefined {
  const unwrapped = unwrap(node);
  return ts.isCallExpression(unwrapped) && ts.isPropertyAccessExpression(unwrapped.expression)
    ? unwrapped.expression.name.text
    : undefined;
}

/**
 * Checks whether an identifier refers to an imported UI5/ES module.
 */
export function imported(node: ts.Node, module: string): boolean {
  const source = node.getSourceFile();
  let found = false;
  walk(source, (n) => {
    if (
      ts.isImportDeclaration(n) &&
      literal(n.moduleSpecifier) === module &&
      n.importClause?.name?.text === node.getText()
    ) {
      found = true;
    }
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
        if (
          index >= 0 &&
          factory.parameters[index]?.name.getText(source) === node.getText(source)
        ) {
          found = true;
        }
      }
    }
  });
  return found;
}

/**
 * Resolves unambiguous, preceding lexical declarations and reaching assignments.
 * Supports lexical scopes, shadowing, and cycle detection without cross-function guessing.
 */
export function initializer(
  identifier: ts.Identifier,
  depth = 0,
  visited = new Set<number>(),
): ts.Expression | undefined {
  if (depth > 8) return undefined;
  if (visited.has(identifier.pos)) return undefined;
  visited.add(identifier.pos);

  let scope: ts.Node | undefined = identifier.parent;
  while (scope) {
    if (ts.isBlock(scope) || ts.isSourceFile(scope) || ts.isFunctionLike(scope)) {
      // If shadowed by parameter in this function scope, provenance cannot be statically assumed
      if (
        ts.isFunctionLike(scope) &&
        scope.parameters.some((p) => ts.isIdentifier(p.name) && p.name.text === identifier.text)
      ) {
        return undefined;
      }

      const declarations: ts.VariableDeclaration[] = [];
      const scanDeclarations = (n: ts.Node): void => {
        if (n !== scope && (ts.isFunctionLike(n) || ts.isBlock(n))) return;
        if (
          ts.isVariableDeclaration(n) &&
          ts.isIdentifier(n.name) &&
          n.name.text === identifier.text
        ) {
          declarations.push(n);
        }
        ts.forEachChild(n, scanDeclarations);
      };
      scanDeclarations(scope);

      if (declarations.length === 1) {
        const decl = declarations[0];
        if (!decl || decl.pos >= identifier.pos) {
          return undefined; // Declared after use or not found
        }

        const isConst =
          decl.parent &&
          ts.isVariableDeclarationList(decl.parent) &&
          Boolean(decl.parent.flags & ts.NodeFlags.Const);

        if (isConst && decl.initializer) {
          const initExpr = unwrap(decl.initializer) as ts.Expression;
          if (ts.isIdentifier(initExpr)) {
            return initializer(initExpr, depth + 1, visited);
          }
          return initExpr;
        }

        // For let/var declarations, collect preceding assignments in the same scope
        const assignments: { pos: number; right: ts.Expression }[] = [];
        const scanAssignments = (n: ts.Node): void => {
          if (n !== scope && (ts.isFunctionLike(n) || ts.isBlock(n))) return;
          if (
            ts.isBinaryExpression(n) &&
            n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
            ts.isIdentifier(n.left) &&
            n.left.text === identifier.text
          ) {
            assignments.push({ pos: n.pos, right: unwrap(n.right) as ts.Expression });
          }
          ts.forEachChild(n, scanAssignments);
        };
        scanAssignments(scope);

        const preceding = assignments.filter((a) => a.pos < identifier.pos);
        if (preceding.length > 0) {
          const latest = preceding[preceding.length - 1];
          if (latest) {
            if (ts.isIdentifier(latest.right)) {
              return initializer(latest.right, depth + 1, visited);
            }
            return latest.right;
          }
        }

        // If no assignment before use, use the initial declaration if it preceded use
        if (decl.initializer) {
          const initExpr = unwrap(decl.initializer) as ts.Expression;
          if (ts.isIdentifier(initExpr)) {
            return initializer(initExpr, depth + 1, visited);
          }
          return initExpr;
        }
      }

      if (declarations.length > 1) {
        // Ambiguous multiple declarations in same scope (e.g. repeated var declarations)
        return undefined;
      }
    }
    scope = scope.parent;
  }
  return undefined;
}

/**
 * Traces an expression to identify if it evaluates to an OData V2 or V4 model instance.
 */
export function modelVersion(
  node: ts.Expression,
  project: ProjectContext,
  depth = 0,
): "v2" | "v4" | undefined {
  if (depth > 6) return;
  const target = unwrap(node) as ts.Expression;
  if (ts.isIdentifier(target)) {
    const init = initializer(target);
    return init ? modelVersion(init, project, depth + 1) : undefined;
  }
  if (ts.isNewExpression(target)) {
    if (
      imported(target.expression, "sap/ui/model/odata/v2/ODataModel") ||
      imported(target.expression, "sap/ui/model/odata/ODataModel") ||
      target.expression.getText() === "sap.ui.model.odata.ODataModel" ||
      target.expression.getText() === "sap.ui.model.odata.v2.ODataModel"
    )
      return "v2";
    if (
      imported(target.expression, "sap/ui/model/odata/v4/ODataModel") ||
      target.expression.getText() === "sap.ui.model.odata.v4.ODataModel"
    )
      return "v4";
  }
  if (
    ts.isCallExpression(target) &&
    method(target) === "getModel" &&
    ts.isPropertyAccessExpression(target.expression)
  ) {
    const receiver = target.expression.expression.getText();
    if (!["this", "this.getView()", "this.getOwnerComponent()"].includes(receiver)) return;
    const name = target.arguments.length ? literal(target.arguments[0]) : "";
    if (name !== undefined) return project.models[name];
  }
}

/**
 * Traces whether an expression represents an OData V4 list/context binding.
 */
export function isODataBinding(
  node: ts.Expression,
  project: ProjectContext,
  depth = 0,
): "v2" | "v4" | undefined {
  if (depth > 6) return undefined;
  const target = unwrap(node) as ts.Expression;
  if (ts.isIdentifier(target)) {
    const init = initializer(target);
    return init ? isODataBinding(init, project, depth + 1) : undefined;
  }
  if (ts.isCallExpression(target)) {
    const m = method(target);
    if (
      (m === "bindList" || m === "bindContext") &&
      ts.isPropertyAccessExpression(target.expression)
    ) {
      return modelVersion(target.expression.expression, project);
    }
  }
  return undefined;
}

/**
 * Traces whether an expression evaluates to an OData collection.
 * Distinguishes:
 * - V2: ODataModel.getProperty("/...") or ODataModel.read success results
 * - V4: contexts returned by listBinding.requestContexts()
 * Does not flag UI5 binding-level operations (e.g. binding.filter(new Filter(...))).
 */
export function odataCollection(node: ts.Expression, project: ProjectContext, depth = 0): boolean {
  if (depth > 6) return false;
  const target = unwrap(node) as ts.Expression;

  if (ts.isIdentifier(target)) {
    const init = initializer(target);
    if (init && odataCollection(init, project, depth + 1)) return true;
  }

  // --- V2: model.getProperty("/...") ---
  if (
    ts.isCallExpression(target) &&
    method(target) === "getProperty" &&
    ts.isPropertyAccessExpression(target.expression)
  ) {
    return (
      modelVersion(target.expression.expression, project) === "v2" &&
      (literal(target.arguments[0])?.startsWith("/") ?? false)
    );
  }

  // --- V2: model.read("/Orders", { success(data) { data.results.filter(...) } }) ---
  if (
    ts.isPropertyAccessExpression(target) &&
    target.name.text === "results" &&
    ts.isIdentifier(target.expression)
  ) {
    let parent: ts.Node | undefined = target.parent;
    while (parent && !ts.isFunctionLike(parent)) parent = parent.parent;
    if (
      parent &&
      ts.isFunctionLike(parent) &&
      parent.parameters[0]?.name.getText() === target.expression.text
    ) {
      const holder = parent.parent;
      const success =
        (ts.isPropertyAssignment(holder) && holder.name.getText() === "success") ||
        (ts.isMethodDeclaration(parent) && parent.name.getText() === "success");
      const options = ts.isMethodDeclaration(parent) ? parent.parent : holder?.parent;
      if (success && ts.isObjectLiteralExpression(options) && ts.isCallExpression(options.parent)) {
        const read = options.parent;
        return (
          method(read) === "read" &&
          ts.isPropertyAccessExpression(read.expression) &&
          modelVersion(read.expression.expression, project) === "v2"
        );
      }
    }
  }

  // --- V4: (await listBinding.requestContexts()) or listBinding.requestContexts() ---
  if (ts.isCallExpression(target) && method(target) === "requestContexts") {
    if (ts.isPropertyAccessExpression(target.expression)) {
      const bindingReceiver = target.expression.expression;
      const bindingVer = isODataBinding(bindingReceiver, project);
      if (bindingVer === "v4" || bindingVer === "v2") {
        return true;
      }
    }
  }

  // --- V4 in Promise .then((contexts) => contexts.filter(...)) ---
  if (ts.isIdentifier(target)) {
    let parent: ts.Node | undefined = target.parent;
    while (parent && !ts.isFunctionLike(parent)) parent = parent.parent;
    if (
      parent &&
      ts.isFunctionLike(parent) &&
      parent.parameters[0]?.name.getText() === target.text
    ) {
      const thenCall = parent.parent;
      if (
        thenCall &&
        ts.isCallExpression(thenCall) &&
        method(thenCall) === "then" &&
        ts.isPropertyAccessExpression(thenCall.expression)
      ) {
        const caller = unwrap(thenCall.expression.expression) as ts.Expression;
        if (
          ts.isCallExpression(caller) &&
          method(caller) === "requestContexts" &&
          ts.isPropertyAccessExpression(caller.expression)
        ) {
          const bindingVer = isODataBinding(caller.expression.expression, project);
          if (bindingVer === "v4" || bindingVer === "v2") {
            return true;
          }
        }
      }
    }
  }

  return false;
}

export interface NetworkCall {
  url: string;
  method: string;
}

export function network(node: ts.Node): NetworkCall | undefined {
  const target = unwrap(node);
  if (!ts.isCallExpression(target)) return;
  const name = target.expression.getText();
  if (name === "fetch" || name === "window.fetch") {
    const url = resolveConstantString(target.arguments[0]) ?? literal(target.arguments[0]);
    if (url)
      return {
        url,
        method: (
          resolveConstantString(property(target.arguments[1], "method")) ??
          literal(property(target.arguments[1], "method")) ??
          "GET"
        ).toUpperCase(),
      };
  }
  if (name === "jQuery.ajax" || name === "$.ajax") {
    const url =
      resolveConstantString(property(target.arguments[0], "url")) ??
      literal(property(target.arguments[0], "url"));
    if (url)
      return {
        url,
        method: (
          resolveConstantString(property(target.arguments[0], "method")) ??
          literal(property(target.arguments[0], "method")) ??
          resolveConstantString(property(target.arguments[0], "type")) ??
          literal(property(target.arguments[0], "type")) ??
          "GET"
        ).toUpperCase(),
      };
  }
  if (
    method(target) === "open" &&
    ts.isPropertyAccessExpression(target.expression) &&
    ts.isIdentifier(target.expression.expression)
  ) {
    const init = initializer(target.expression.expression);
    const url = resolveConstantString(target.arguments[1]) ?? literal(target.arguments[1]);
    if (init && ts.isNewExpression(init) && init.expression.getText() === "XMLHttpRequest" && url)
      return {
        url,
        method: (
          resolveConstantString(target.arguments[0]) ??
          literal(target.arguments[0]) ??
          "GET"
        ).toUpperCase(),
      };
  }
}

/**
 * Detects proven synchronous network requests across $.ajax, XMLHttpRequest, and legacy OData APIs.
 */
export function isSyncNetworkCall(node: ts.Node, project: ProjectContext): boolean {
  const target = unwrap(node);

  // $.ajax({ async: false }) or jQuery.ajax({ async: false })
  if (ts.isCallExpression(target)) {
    const exprText = target.expression.getText();
    if (exprText === "$.ajax" || exprText === "jQuery.ajax") {
      const asyncProp = property(target.arguments[0], "async");
      if (asyncProp) {
        const val = unwrap(asyncProp);
        if (val.kind === ts.SyntaxKind.FalseKeyword) return true;
        if (ts.isIdentifier(val)) {
          const resolved = initializer(val);
          if (resolved && resolved.kind === ts.SyntaxKind.FalseKeyword) return true;
        }
      }
    }

    // xhr.open(method, url, false)
    if (
      method(target) === "open" &&
      target.arguments.length >= 3 &&
      ts.isPropertyAccessExpression(target.expression)
    ) {
      const receiver = unwrap(target.expression.expression);
      let isXhr = false;
      if (ts.isNewExpression(receiver) && receiver.expression.getText() === "XMLHttpRequest") {
        isXhr = true;
      } else if (ts.isIdentifier(receiver)) {
        const init = initializer(receiver);
        if (init && ts.isNewExpression(init) && init.expression.getText() === "XMLHttpRequest") {
          isXhr = true;
        }
      }
      if (isXhr) {
        const asyncArg = unwrap(target.arguments[2]);
        if (asyncArg?.kind === ts.SyntaxKind.FalseKeyword) return true;
        if (asyncArg && ts.isIdentifier(asyncArg)) {
          const resolved = initializer(asyncArg);
          if (resolved && resolved.kind === ts.SyntaxKind.FalseKeyword) return true;
        }
      }
    }
  }

  // Legacy/V2 ODataModel.read(path, { async: false })
  if (
    ts.isCallExpression(target) &&
    method(target) === "read" &&
    ts.isPropertyAccessExpression(target.expression) &&
    modelVersion(target.expression.expression, project) === "v2"
  ) {
    const asyncProp = property(target.arguments[1], "async");
    if (asyncProp && unwrap(asyncProp).kind === ts.SyntaxKind.FalseKeyword) return true;
  }

  return false;
}

export function isOdataUrl(url: string, p: ProjectContext): boolean {
  return (
    /\/sap\/opu\/odata(?:4)?\//i.test(url) ||
    p.services.some(
      (s) => s !== "/" && (url === s || url.startsWith(s.endsWith("/") ? s : `${s}/`)),
    )
  );
}
