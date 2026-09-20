import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The hash of the admin PIN was readable by every signed-in account for three months.
 *
 * April closed it twice. 20260421105946 replaced the table-level SELECT on
 * system_settings with a column list that deliberately left admin_pin out, and
 * 20260423202741 repeated it. Then 20260627071614 added two columns and, to grant
 * them, wrote `GRANT SELECT, INSERT, UPDATE, DELETE ON public.system_settings TO
 * authenticated`. A table-level grant covers EVERY column, so that one line silently
 * undid both. 20260729180000 noticed the same trap on UPDATE and rebuilt it column by
 * column; nobody went back for SELECT.
 *
 * What sat in the open was the bcrypt of a four-digit PIN — 10 000 candidates, broken
 * offline in seconds by anyone holding the row, leaving no trace in this system at
 * all. The only thing standing in front of it was RLS, and the admin role is on 10 of
 * 29 accounts.
 *
 * This is the same class of bug as everyColumnTheScreenWritesIsGranted, from the other
 * direction: that test fails when a column a screen writes has NO grant, this one fails
 * when a column nothing should read HAS one. Both exist because a table-level grant is
 * one line, reads like housekeeping, and cancels every column list before it.
 *
 * WHAT IT DOES NOT DO: it reads the migrations, not the database. A grant applied by
 * hand and never written down is invisible here, and so is one written down and never
 * applied — 20260925090000 only counts once somebody pastes it. It also only reads
 * `src/`: the edge functions that touch system_settings all go through the service_role
 * client, which no grant in this file governs.
 */

const ROOT = resolve(__dirname, "../..");
const MIGRATIONS = resolve(ROOT, "supabase/migrations");

/** Every column of system_settings, as types.ts has them. */
const COLUNAS = [
  "id",
  "admin_pin",
  "created_at",
  "updated_at",
  "intouch_auto_wo_enabled",
  "intouch_sync_enabled",
  "rag_api_base_url",
];

/** The files that read system_settings from the browser. */
const FICHEIROS_QUE_LEEM = [
  "src/components/AutoWoDisabledBanner.tsx",
  "src/components/rag/RagApiAddressDialog.tsx",
  "src/pages/dashboard/IntouchSettingsPage.tsx",
];

const migrationFiles = () =>
  readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();

/**
 * Replays the migrations and reports what `privilegio` on system_settings the role
 * `authenticated` is left holding.
 *
 * `null` means a table-level grant is standing, which covers every column — including
 * the ones a column list was written to exclude. That is the state this test exists to
 * catch, so it is reported rather than flattened into "everything is granted".
 */
function grantsAposTodasAsMigracoes(privilegio: "SELECT" | "UPDATE"): Set<string> | null {
  let colunas: Set<string> | null = new Set();

  for (const file of migrationFiles()) {
    const sql = readFileSync(resolve(MIGRATIONS, file), "utf8")
      // The comments in 20260729180000 and 20260925090000 quote the very statements
      // this scans for, in prose that would otherwise read as a grant.
      .replace(/--[^\n]*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");

    const revoke = new RegExp(
      `REVOKE\\s+[^;]*\\b(?:${privilegio}|ALL)\\b[^;]*\\bON\\s+(?:public\\.)?system_settings\\s+FROM`,
      "is",
    );
    if (revoke.test(sql)) colunas = new Set();

    for (const m of sql.matchAll(
      /GRANT\s+([^;]*?)\bON\s+(?:public\.)?system_settings\s+TO\s+([^;]+);/gis,
    )) {
      const [, privilegios, destinatarios] = m;
      if (!/\bauthenticated\b/i.test(destinatarios)) continue;

      const comColunas = new RegExp(`\\b${privilegio}\\s*\\(([^)]*)\\)`, "i").exec(privilegios);
      if (comColunas) {
        if (colunas === null) continue; // already table-wide; a column grant adds nothing
        for (const c of comColunas[1].split(",")) colunas.add(c.trim());
        continue;
      }
      // A privilege named with no column list after it is table-wide, and so is ALL.
      const semListas = privilegios.replace(/\([^)]*\)/g, "");
      if (new RegExp(`\\b(${privilegio}|ALL)\\b`, "i").test(semListas)) colunas = null;
    }
  }

  return colunas;
}

/** Literal column names of every `.select("…")` aimed at system_settings in a file. */
function colunasLidasPor(file: string): string[] {
  const src = readFileSync(resolve(ROOT, file), "utf8");
  const nomes: string[] = [];

  for (const m of src.matchAll(
    /from\(\s*["']system_settings["']\s*\)[\s\S]{0,200}?\.select\(\s*["']([^"']*)["']/g,
  )) {
    for (const parte of m[1].split(",")) {
      const nome = parte.trim();
      if (/^[a-z_][a-z0-9_]*$/.test(nome)) nomes.push(nome);
    }
  }
  return nomes;
}

describe("the admin PIN hash is not readable through PostgREST", () => {
  const select = grantsAposTodasAsMigracoes("SELECT");
  const update = grantsAposTodasAsMigracoes("UPDATE");

  it("finds migrations and reading screens at all", () => {
    // Without this, a moved file or a renamed table makes every assertion below
    // vacuously green — the failure mode of every test that scans a directory.
    expect(migrationFiles().length).toBeGreaterThan(50);
    expect(FICHEIROS_QUE_LEEM.flatMap(colunasLidasPor).length).toBeGreaterThan(0);
  });

  it("has not gone back to a table-level SELECT grant", () => {
    // This is the assertion that was false from 27/06/2026 to 25/09/2026. A table-level
    // grant is how admin_pin became readable both times, so it is asserted on its own
    // rather than folded into the column check below.
    expect(select).not.toBeNull();
  });

  it("does not grant SELECT on admin_pin", () => {
    expect(select === null || select.has("admin_pin")).toBe(false);
  });

  it("does not grant UPDATE on admin_pin either", () => {
    // A PATCH straight at the column would write the PIN in clear over its own hash,
    // after which crypt(_pin, admin_pin) compares nothing. The only writer is
    // set_admin_pin(), SECURITY DEFINER, reached from the update-admin-pin function.
    expect(update === null || update.has("admin_pin")).toBe(false);
  });

  for (const file of FICHEIROS_QUE_LEEM) {
    for (const coluna of colunasLidasPor(file)) {
      it(`${file} can still read ${coluna}`, () => {
        // The cost of closing a table-level grant: every column a screen reads has to
        // be named again, and a column left out fails as "permission denied for table
        // system_settings" — a message that sends whoever reads it into the RLS
        // policies, where the answer is not.
        // `null` is the table-wide grant, which does let the screen read it — the
        // assertion above is where that state fails, and saying it twice would report
        // one hole as eight.
        expect(select === null || select.has(coluna)).toBe(true);
      });
    }
  }

  it("names every system_settings column in one list or the other", () => {
    // A column that is neither granted nor deliberately withheld is a column somebody
    // added without deciding, which is how rag_api_base_url spent five weeks unwritable.
    const retidas = ["admin_pin", "intouch_sync_enabled"];
    for (const coluna of COLUNAS) {
      expect(select === null || select.has(coluna) || retidas.includes(coluna)).toBe(true);
    }
  });
});

describe("the admin PIN tires of being guessed", () => {
  const lockout = readFileSync(
    resolve(MIGRATIONS, "20260925091000_o_pin_de_admin_cansa_se_de_ser_adivinhado.sql"),
    "utf8",
  );
  const leader = readFileSync(
    resolve(MIGRATIONS, "20260712215321_6e39b132-8674-4306-9053-0561ca99b13e.sql"),
    "utf8",
  );

  const escada = (sql: string) =>
    /_ladder\s+constant\s+integer\[\]\s*:=\s*ARRAY\[([^\]]*)\]/i.exec(sql)?.[1].replace(/\s/g, "");
  const livres = (sql: string) =>
    /_max_free\s+constant\s+integer\s*:=\s*(\d+)/i.exec(sql)?.[1];

  it("climbs the same ladder the leader PIN climbs", () => {
    // Two different ladders for the same factory would be two different answers to the
    // same question, and the one nobody looked at would be the lenient one.
    expect(escada(lockout)).toBe(escada(leader));
    expect(escada(lockout)).toBe("30,60,120,300");
    expect(livres(lockout)).toBe(livres(leader));
  });

  it("counts against its own table, not the leaders'", () => {
    // Sharing pin_attempts would make a fumbled admin PIN lock out the engineer PIN of
    // the same account, and would mean editing verify_pin_with_lockout — the function
    // the whole factory signs in through.
    expect(lockout).toMatch(/CREATE TABLE IF NOT EXISTS public\.admin_pin_attempts/);
    expect(lockout).not.toMatch(/\bpublic\.pin_attempts\b(?![^\n]*--)/);
  });

  it("never signals the lock by raising", () => {
    // The call is one transaction. A RAISE after the counter is written rolls the
    // counter back, so the lockout would never survive the statement that set it. The
    // only RAISE allowed here is the admin-role refusal, which writes nothing.
    const raises = [...lockout.matchAll(/RAISE\s+EXCEPTION\s+'([^']*)'/gi)].map((m) => m[1]);
    expect(raises).toEqual(["Forbidden: admin role required"]);
    expect(lockout).toMatch(/'error',\s*'locked'/);
  });

  it("leaves the boolean verify_admin_pin standing and delegating", () => {
    // set_intouch_sync_enabled() calls it, and CREATE OR REPLACE at the same signature
    // is what keeps the grants 20260418090223 and 20260623230737 left behind. It must
    // not do its own crypt() comparison, or the console path skips the counter.
    const corpo = lockout.slice(lockout.indexOf("FUNCTION public.verify_admin_pin(_pin text)"));
    expect(corpo).toMatch(/verify_admin_pin_with_lockout\(_pin\)/);
    expect(corpo).not.toMatch(/crypt\(/);
  });

  it("takes back the EXECUTE that recreating a function hands to anon", () => {
    expect(lockout).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.verify_admin_pin_with_lockout\(text\) FROM PUBLIC, anon;/,
    );
    expect(lockout).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.verify_admin_pin\(text\) FROM PUBLIC, anon;/,
    );
  });

  it("is carried byte for byte by the file a person pastes", () => {
    // docs/apply-passo-3/APLICAR-57-58-pin-de-admin.sql exists because the full
    // package is 58 blocks and 56 of them are already applied. A shortcut that
    // paraphrases its migrations is a second source of truth for the schema, which is
    // the thing this repository keeps failing on — so it is compared, not trusted.
    const paste = readFileSync(
      resolve(ROOT, "docs/apply-passo-3/APLICAR-57-58-pin-de-admin.sql"),
      "utf8",
    );
    for (const f of [
      "20260925090000_o_pin_de_admin_nao_se_le.sql",
      "20260925091000_o_pin_de_admin_cansa_se_de_ser_adivinhado.sql",
    ]) {
      expect(paste).toContain(readFileSync(resolve(MIGRATIONS, f), "utf8").trimEnd());
    }
  });

  it("is what the screen and the edge function actually call", () => {
    // A ladder nothing climbs is a ladder that guards nothing.
    const fn = readFileSync(resolve(ROOT, "supabase/functions/verify-admin-pin/index.ts"), "utf8");
    expect(fn).toMatch(/verify_admin_pin_with_lockout/);
    expect(fn).toMatch(/status:\s*429/);

    const gate = readFileSync(resolve(ROOT, "src/components/AdminPinGate.tsx"), "utf8");
    expect(gate).toMatch(/429/);
    expect(gate).toMatch(/locked_seconds/);
  });
});
