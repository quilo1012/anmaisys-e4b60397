import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * "update or delete on table sku_products violates foreign key constraint
 * production_targets_sku_id_fkey" reached an admin on /dashboard/sku-products.
 *
 * The rules that keep it from coming back, checked at every call site:
 *  - an edit updates the existing row by id and never sends the id;
 *  - nothing deletes-and-reinserts or upserts over an existing SKU, which would
 *    rename it or bring a deactivated one back to life;
 *  - every write asks for its rows back, because RLS reports a refused
 *    UPDATE/DELETE as "0 rows" rather than an error, and the page must not say
 *    "Saved" or "Deleted" when nothing changed;
 *  - deactivated SKUs are not offered for new production.
 */

const SRC = resolve(__dirname, "..");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "__tests__" ? [] : walk(p);
    return /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
  });

/** Each `.from("sku_products")` chain up to the end of its statement. */
const skuChains = () =>
  walk(SRC).flatMap((file) => {
    const text = readFileSync(file, "utf8");
    const out: { file: string; chain: string }[] = [];
    const re = /\.from\(\s*["']sku_products["']\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const end = text.indexOf(";", m.index);
      out.push({ file: file.slice(SRC.length + 1), chain: text.slice(m.index, end === -1 ? undefined : end) });
    }
    return out;
  });

describe("writes to sku_products", () => {
  const writes = skuChains().filter(({ chain }) => /\.(update|insert|upsert|delete)\(/.test(chain));

  it("are found (the scan itself works)", () => {
    expect(writes.length).toBeGreaterThanOrEqual(4);
  });

  it("all ask for their rows back, so a zero-row write cannot pass as success", () => {
    const blind = writes.filter(({ chain }) => !/\.select\(/.test(chain));
    expect(blind.map((w) => `${w.file}: ${w.chain.slice(0, 80)}`)).toEqual([]);
  });

  it("never upsert over an existing SKU (that renames it and reactivates retired ones)", () => {
    const overwriting = writes.filter(({ chain }) => /\.upsert\(/.test(chain) && !/ignoreDuplicates:\s*true/.test(chain));
    expect(overwriting.map((w) => w.file)).toEqual([]);
  });

  it("update and delete only by the existing primary key", () => {
    const unkeyed = writes.filter(({ chain }) => /\.(update|delete)\(/.test(chain) && !/\.eq\(\s*["']id["']/.test(chain));
    expect(unkeyed.map((w) => `${w.file}: ${w.chain.slice(0, 80)}`)).toEqual([]);
  });
});

describe("the SKU Products page", () => {
  const page = readFileSync(resolve(SRC, "pages/dashboard/SKUProductsPage.tsx"), "utf8");

  it("checks the returned rows before reporting success", () => {
    expect((page.match(/assertSkuRowsChanged\(/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it("offers deactivation when a delete is refused because production uses the SKU", () => {
    expect(page).toMatch(/isSkuInUse\(e\)/);
    expect(page).toMatch(/label:\s*"Deactivate"/);
    expect(page).toMatch(/update\(\{\s*active:\s*false\s*\}\)\.eq\("id", sku\.id\)/);
  });
});

describe("new production", () => {
  it("only offers active SKUs in the operator's SKU search", () => {
    const text = readFileSync(resolve(SRC, "pages/dashboard/MyProductionPage.tsx"), "utf8");
    const search = text.slice(text.indexOf('queryKey: ["log-prod-sku-search"'));
    expect(search.slice(0, 1500)).toMatch(/\.eq\("active", true\)/);
  });
});
