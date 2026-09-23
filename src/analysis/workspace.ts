import { getNodeValue, type Node as JsonNode, type ParseError, parseTree } from "jsonc-parser";
import { SaxesParser } from "saxes";
import ts from "typescript";
import { parseAllDocuments } from "yaml";
import type { Diagnostic } from "../core/types.js";
import type { SourceFile } from "../filesystem/discovery.js";

export interface XmlElement {
  name: string;
  uri: string;
  attributes: Record<string, string>;
  line: number;
  column: number;
}
export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function string(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
export function at(value: unknown, ...keys: string[]): unknown {
  return keys.reduce<unknown>((v, key) => object(v)[key], value);
}
export class Workspace {
  readonly diagnostics: Diagnostic[];
  readonly data = new Map<string, unknown>();
  readonly json = new Map<string, JsonNode>();
  readonly ast = new Map<string, ts.SourceFile>();
  readonly xml = new Map<string, XmlElement[]>();
  constructor(
    readonly files: readonly SourceFile[],
    diagnostics: Diagnostic[] = [],
  ) {
    this.diagnostics = [...diagnostics];
    for (const file of files) this.parse(file);
  }
  get(file: string): unknown {
    return this.data.get(file);
  }
  has(file: string): boolean {
    return this.files.some((f) => f.path === file);
  }
  location(file: string, offset: number): { line: number; column: number } {
    const text = this.files.find((f) => f.path === file)?.text ?? "";
    const before = text.slice(0, offset);
    return { line: before.split("\n").length, column: offset - before.lastIndexOf("\n") };
  }
  private parse(file: SourceFile): void {
    try {
      if (/\.[cm]?[jt]s$/.test(file.path)) {
        const source = ts.createSourceFile(
          file.path,
          file.text,
          ts.ScriptTarget.Latest,
          true,
          file.path.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS,
        );
        const diagnostics = (
          source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }
        ).parseDiagnostics;
        if (diagnostics.length) {
          const pos = source.getLineAndCharacterOfPosition(diagnostics[0]?.start ?? 0);
          this.diagnostics.push({
            code: "parse",
            file: file.path,
            line: pos.line + 1,
            column: pos.character + 1,
            message: "Unable to parse JavaScript/TypeScript; file excluded from semantic checks.",
          });
        } else this.ast.set(file.path, source);
      } else if (file.path.endsWith(".json")) {
        const errors: ParseError[] = [];
        const tree = parseTree(file.text, errors, {
          disallowComments: true,
          allowTrailingComma: false,
        });
        if (errors.length || !tree) {
          this.diagnostics.push({
            code: "parse",
            file: file.path,
            ...this.location(file.path, errors[0]?.offset ?? 0),
            message: "Unable to parse JSON; source content omitted.",
          });
          return;
        }
        if (
          /(?:^|\/)(?:package|manifest|xs-app)\.json$/.test(file.path) &&
          tree.type !== "object"
        ) {
          this.diagnostics.push({
            code: "configuration",
            file: file.path,
            ...this.location(file.path, tree.offset),
            message: "This configuration must contain a JSON object.",
          });
          return;
        }
        this.json.set(file.path, tree);
        this.data.set(file.path, getNodeValue(tree) as unknown);
      } else if (/\.ya?ml$/.test(file.path)) {
        const docs = parseAllDocuments(file.text, { uniqueKeys: true });
        if (docs.some((doc) => doc.errors.length)) throw new Error("parse");
        this.data.set(file.path, docs[0]?.toJS({ maxAliasCount: 30 }));
      } else if (file.path.endsWith(".xml")) {
        const elements: XmlElement[] = [];
        const parser = new SaxesParser({ xmlns: true, position: true });
        let line = 1;
        let column = 1;
        parser.on("doctype", () => {
          throw new Error("DTD excluded");
        });
        parser.on("opentagstart", () => {
          const offset = file.text.lastIndexOf("<", parser.position - 1);
          const location = this.location(file.path, Math.max(0, offset));
          line = location.line;
          column = location.column;
        });
        parser.on("opentag", (tag) =>
          elements.push({
            name: tag.local,
            uri: tag.uri,
            attributes: Object.fromEntries(
              Object.values(tag.attributes).map((a) => [a.name, a.value]),
            ),
            line,
            column,
          }),
        );
        parser.on("error", () => {
          throw new Error("parse");
        });
        parser.write(file.text).close();
        this.xml.set(file.path, elements);
      }
    } catch {
      this.diagnostics.push({
        code: "parse",
        file: file.path,
        message: "Unable to parse file safely; source content omitted.",
      });
    }
  }
}
