import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A column added to system_settings is unwritable until someone remembers a GRANT.
 *
 * 20260729180000 dropped the table-level UPDATE grant on system_settings, because a
 * table-level grant covers EVERY column and so revoking admin_pin on its own did
 * nothing. What replaced it is a fixed list, re-granted column by column, plus a
 * comment carrying the standing instruction: "When a column is added to
 * system_settings, GRANT it here too."
 *
 * A comment is not a check. 20260906085832 added rag_api_base_url, nobody came back,
 * and the Settings screen that writes it failed for five weeks with
 * "permission denied for table system_settings" — a message that sends whoever reads
 * it into the RLS policies, where the answer is not, because the policy already
 * allowed the row. PostgreSQL refuses one step earlier, on the column privilege, and
 * says "table" while it does it.
 *
 * What makes this class of bug survive is that it is silent everywhere except in a
 * user's hands: types.ts knows the column, the query builder accepts it, RLS permits
 * it, the migration parses. Only production says no.
 *
 * So this test reads both halves and puts them together — every column the browser
 * updates on system_settings, against the column-level UPDATE grants the migrations
 * actually leave standing. Add a column and wire a screen to it without the GRANT and
 * this fails on the same day, which is the only day anyone is still holding the
 * context to fix it in one line.
 *
 * WHAT IT DOES NOT DO: it reads the migrations, not the database. A grant applied by
 * hand and never written down is invisible here, and so is one written down and never
 * applied. It also only sees literal keys in a `.update({ ... })` object — a payload
 * built from a variable would pass unexamined. Both are the standing limit of every
 * static check in this suite; the answer to either is to probe the live database.
 */

const ROOT = resolve(__dirname, "../..");
const MIGRATIONS = resolve(ROOT, "supabase/migrations");

/** The two screens that write system_settings, and the files are named so a third is noticed. */
const FICHEIROS_QUE_ESCREVEM = [
  "src/components/rag/RagApiAddressDialog.tsx",
  "src/pages/dashboard/IntouchSettingsPage.tsx",
];

/**
 * Replays the migrations in order and reports what UPDATE privilege `authenticated`
 * is left holding on system_settings.
 *
 * `null` means a table-level grant is standing, which covers every column — the state
 * the project deliberately left behind, but a legitimate answer for this function and
 * not one to conflate with "nothing granted".
 */
function updateGrantsAfterEveryMigration(): Set<string> | null {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  let colunas: Set<string> | null = new Set();

  for (const file of files) {
    const sql = readFileSync(resolve(MIGRATIONS, file), "utf8")
      // Comments quote the very statements this scans for; 20260729180000 explains the
      // trap in prose that would otherwise read as a grant.
      .replace(/--[^\n]*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");

    // REVOKE UPDATE ON ... system_settings FROM ...  — the table-level grant goes.
    if (/REVOKE\s+[^;]*\bUPDATE\b[^;]*\bON\s+(?:public\.)?system_settings\s+FROM/is.test(sql)) {
      colunas = new Set();
    }

    for (const m of sql.matchAll(
      /GRANT\s+([^;]*?)\bON\s+(?:public\.)?system_settings\s+TO\s+([^;]+);/gis,
    )) {
      const [, privilegios, destinatarios] = m;
      if (!/\bauthenticated\b/i.test(destinatarios)) continue;

      // GRANT ALL, or a list naming UPDATE with no column list, is table-wide.
      const comColunas = /\bUPDATE\s*\(([^)]*)\)/i.exec(privilegios);
      if (comColunas) {
        if (colunas === null) continue; // already table-wide; a column grant adds nothing
        for (const c of comColunas[1].split(",")) colunas.add(c.trim());
        continue;
      }
      if (/\b(UPDATE|ALL)\b/i.test(privilegios.replace(/\([^)]*\)/g, ""))) {
        colunas = null;
      }
    }
  }

  return colunas;
}

/** Literal keys of every `.update({ ... })` aimed at system_settings in a file. */
function colunasEscritasPor(file: string): string[] {
  const src = readFileSync(resolve(ROOT, file), "utf8");
  const keys: string[] = [];

  // supabase-js always names the table first, so an .update() reached from a
  // from("system_settings") within a few lines is a write to this table and not to
  // whatever else the file touches.
  for (const m of src.matchAll(
    /from\(\s*["']system_settings["']\s*\)[\s\S]{0,200}?\.update\(\s*\{([^}]*)\}/g,
  )) {
    for (const par of m[1].split(",")) {
      const nome = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(par);
      if (nome) keys.push(nome[1]);
    }
  }
  return keys;
}

describe("every system_settings column a screen writes has an UPDATE grant", () => {
  const granted = updateGrantsAfterEveryMigration();

  it("finds migrations and the screens that write them at all", () => {
    // Without this, a moved file or a renamed table would make the assertions below
    // vacuously green — the failure mode of every test that scans a directory.
    expect(readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).length).toBeGreaterThan(50);
    expect(FICHEIROS_QUE_ESCREVEM.flatMap(colunasEscritasPor).length).toBeGreaterThan(0);
  });

  it("has not quietly gone back to a table-level grant", () => {
    // If this ever fails, admin_pin is writable again by any authenticated user the
    // policy lets through, and the PIN gate of 20260729180000 is off. That is a bigger
    // finding than a missing column, so it is asserted on its own.
    expect(granted).not.toBeNull();
  });

  for (const file of FICHEIROS_QUE_ESCREVEM) {
    for (const coluna of colunasEscritasPor(file)) {
      it(`${file} writes ${coluna}`, () => {
        expect(granted === null || granted.has(coluna)).toBe(true);
      });
    }
  }

  it("still keeps intouch_sync_enabled off the direct-write list", () => {
    // The reason the column-by-column shape exists at all. intouch_sync_enabled may only
    // move through set_intouch_sync_enabled(), which demands the admin PIN and writes an
    // audit row; a stray GRANT here would hand it back to a plain PATCH.
    expect(granted?.has("intouch_sync_enabled")).toBe(false);
  });
});
