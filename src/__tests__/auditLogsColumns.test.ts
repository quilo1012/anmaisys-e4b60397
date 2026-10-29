import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// The deployed table's columns, supplied with the 29 Oct 42703 report.
const columns = new Set([
  "id", "user_id", "user_name", "action", "entity_type", "entity_id",
  "details", "ip_address", "created_at",
]);
const src = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function auditReferences(body: string): { reads: number; referenced: string[] } {
  const tree = ts.createSourceFile("query.tsx", body, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const aliases = new Set<string>();
  const referenced: string[] = [];
  let reads = 0;
  const isAudit = (node: ts.Node): boolean => {
    if (ts.isIdentifier(node)) return aliases.has(node.text);
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false;
    if (node.expression.name.text === "from") {
      const arg = node.arguments[0];
      return !!arg && ts.isStringLiteral(arg) && arg.text === "audit_logs";
    }
    return isAudit(node.expression.expression);
  };
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && isAudit(node.initializer)) {
      aliases.add(node.name.text);
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && isAudit(node)) {
      const method = node.expression.name.text;
      const arg = node.arguments[0];
      if (method === "from") reads++;
      if (arg && ["select", "eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is", "in", "order", "not", "filter", "match", "or"].includes(method)) {
        if (method === "or") {
          // Includes template literals nested in arrays joined for PostgREST filters.
          for (const match of arg.getText(tree).matchAll(/(?:["'`(,])\s*([a-z_]+)\.(?:not\.)?(?:eq|neq|gt|gte|lt|lte|like|ilike|is|in)\./g)) referenced.push(match[1]);
        } else if (method === "match" && ts.isObjectLiteralExpression(arg)) {
          for (const property of arg.properties) {
            if (ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
              referenced.push(property.name.text);
            }
          }
        } else if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
          referenced.push(...arg.text.split(",").map((s) => s.trim()).filter((s) => s !== "*"));
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return { reads, referenced };
}

describe("audit_logs reads use only deployed columns", () => {
  it("detects the reported missing column in selects, filters and ordering", () => {
    for (const method of ["select", "eq", "order"]) {
      const result = auditReferences(`db.from("audit_logs").${method}("table_name");`);
      expect(result.referenced.filter((c) => !columns.has(c))).toEqual(["table_name"]);
    }
    expect(auditReferences('let q = db.from("audit_logs").select("*"); q = q.eq("table_name", "products");').referenced).toContain("table_name");
    expect(auditReferences('db.from("audit_logs").or(`table_name.ilike.%${term}%`);').referenced).toContain("table_name");
    expect(auditReferences('db.from("audit_logs").match({ table_name: "products" });').referenced).toContain("table_name");
    expect(auditReferences('db.from("audit_logs").select(`id,table_name`);').referenced).toContain("table_name");
  });

  it("rejects any missing audit column, not just table_name", () => {
    const result = auditReferences('db.from("audit_logs").select("id,missing_column").order("another_missing_column");');
    expect(result.referenced.filter((column) => !columns.has(column)).sort()).toEqual(["another_missing_column", "missing_column"]);
  });

  it("checks every current audit query, including search filters", () => {
    let reads = 0;
    const found: string[] = [];
    for (const file of walk(src).filter((p) => /\.tsx?$/.test(p) && !/\.test\.tsx?$|__tests__/.test(p))) {
      const result = auditReferences(readFileSync(file, "utf8"));
      reads += result.reads;
      found.push(...result.referenced);
      expect(result.referenced.filter((c) => !columns.has(c)), file).toEqual([]);
    }
    expect(reads).toBeGreaterThanOrEqual(2);
    expect(found).toContain("entity_type");
    expect(found).toContain("user_name");
    expect(found).toContain("created_at");
  });
});