import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * `profiles` is readable column by column, not as a table.
 *
 * 20260724130000_secure_labor_rate.sql revoked the table-wide SELECT so `labor_rate`
 * could not be read, and granted the other columns one by one. A column added later is
 * not in that list. BLOCO 108 added `avatar_path`, the Communication Hub read it
 * straight from the table, and every person who opened it — admin included — got
 * `42501 permission denied for table profiles`, shown as "You do not have access to
 * this" (20/10/2026). The photo is read through `chat_people` instead.
 *
 * So a select on `profiles` in the client may name only the granted columns. A new
 * column belongs in a grant (a migration) or behind a function — not here.
 */
const GRANTED = new Set([
  "id", "name", "email", "shift", "active", "production_line", "ui_preferences",
  "last_seen_at", "created_at", "updated_at",
]);

const SRC = resolve(__dirname, "..");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "integrations" ? [] : files(p);
    return /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) ? [p] : [];
  });
}

describe("reads of profiles name only granted columns", () => {
  const found: { file: string; columns: string[] }[] = [];
  for (const file of files(SRC)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/from\(\s*["']profiles["']\s*\)[\s\S]{0,200}?\.select\(\s*["'`]([^"'`]*)["'`]/g)) {
      found.push({ file: file.slice(SRC.length + 1), columns: m[1].split(",").map((c) => c.trim()).filter(Boolean) });
    }
  }

  it("finds the reads at all", () => {
    expect(found.length).toBeGreaterThan(5);
  });

  it("asks for no column outside the grant", () => {
    const outside = found.flatMap((f) => f.columns.filter((c) => !GRANTED.has(c)).map((c) => `${f.file}: ${c}`));
    expect(outside).toEqual([]);
  });
});
