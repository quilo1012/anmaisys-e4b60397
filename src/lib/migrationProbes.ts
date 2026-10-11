/**
 * What a migration promises the database, in a shape that can be asked about from
 * outside it.
 *
 * Nothing in this repository applies a migration: a person pastes
 * `docs/apply-passo-3/APPLY-ALL-IN-ORDER.sql` into the SQL editor. So a merge looks
 * exactly like a deployment and is not one, and the gap between them is invisible —
 * CI is green, the file is on main, and the database has never heard of it.
 *
 * Every surprise in this codebase's recent history is that gap: a bridge merged on
 * 07/10 and still absent on the 11th; a role offered by a screen and refused by an
 * enum; a security fix reviewed, merged and not applied while the exposure it closes
 * answered 200 to anonymous callers for four days. `docs/apply/probe-schema.sh` was
 * written for the same reason and hardcodes a list from August, so it answers a
 * question nobody is asking any more.
 *
 * This derives the questions from the migrations themselves, so the list cannot go
 * stale. It reads SQL and returns what to ask PostgREST — nothing more; the asking is
 * somebody else's job, because this half has to be testable without a network.
 *
 * THE FOUR SHAPES, AND HOW THE BACKEND ANSWERS WHEN THE THING IS MISSING. Each is a
 * distinct error, and each has been observed against this project's production:
 *
 *   function  POST /rpc/<name>              → 404 PGRST202
 *   column    GET  /<table>?select=<column> → 400 42703
 *   table     GET  /<table>?select=*        → 404 PGRST205
 *   enum      GET  /<table>?<col>=eq.<value> → 400 22P02
 *
 * The enum one is the subtle one and the reason this file exists in this shape: a
 * filter makes Postgres coerce the literal to the enum BEFORE row-level security is
 * consulted, so a valid value comes back 401/42501 — stopped by RLS, which means it
 * got that far — and an invalid one comes back 400/22P02. That distinction is what
 * finally read the live enum without any credential at all.
 */

export type ProbeKind = "function" | "column" | "table" | "enum";

export interface Probe {
  kind: ProbeKind;
  /** Function name, table name, or the enum's type name. */
  name: string;
  /** Column for a column probe; the value for an enum probe. */
  detail?: string;
  /** The table a column or enum probe goes through. */
  table?: string;
  /** Which migration asked for it, for the report. */
  migration: string;
  /**
   * The function's parameter names, for a `function` probe.
   *
   * PostgREST resolves an overload by ARGUMENT NAME, so a POST with an empty body
   * asks for the zero-argument overload and answers `PGRST202` when the function
   * takes parameters — which reads exactly like "the function is not there". That
   * cost a false report on 11/10/2026: `link_me_to_employee` was called with `{}`,
   * answered PGRST202, and went into a list of unkept promises although it had been
   * in the database all along. The names go in the body so the question matches the
   * function that was actually written.
   */
  args?: string[];
}

const FUNCTION_RE = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z0-9_]+)\s*\(([^)]*)\)/gi;
const COLUMN_RE = /alter\s+table\s+(?:public\.)?([a-z0-9_]+)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z0-9_]+)/gi;
const TABLE_RE = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z0-9_]+)/gi;
const ENUM_RE = /alter\s+type\s+(?:public\.)?([a-z0-9_]+)\s+add\s+value\s+(?:if\s+not\s+exists\s+)?'([a-z0-9_]+)'/gi;

/** Strip comments so a sentence about a function is not mistaken for one. */
function withoutComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

/**
 * Trigger functions are skipped: they return `trigger`, are never callable over
 * PostgREST, and probing one proves nothing either way. The same is true of anything
 * a migration only drops.
 */
export function probesFor(sql: string, migration: string): Probe[] {
  const body = withoutComments(sql);
  const out: Probe[] = [];
  const seen = new Set<string>();
  const add = (p: Probe) => {
    const key = `${p.kind}:${p.name}:${p.detail ?? ""}`;
    if (!seen.has(key)) { seen.add(key); out.push(p); }
  };

  for (const m of body.matchAll(FUNCTION_RE)) {
    // `returns trigger` within the next few lines means this is not callable.
    const after = body.slice(m.index ?? 0, (m.index ?? 0) + 400);
    if (/returns\s+trigger/i.test(after)) continue;
    add({ kind: "function", name: m[1], args: paramNames(m[2]), migration });
  }
  for (const m of body.matchAll(COLUMN_RE)) {
    add({ kind: "column", name: m[1], detail: m[2], table: m[1], migration });
  }
  for (const m of body.matchAll(TABLE_RE)) {
    add({ kind: "table", name: m[1], migration });
  }
  for (const m of body.matchAll(ENUM_RE)) {
    add({ kind: "enum", name: m[1], detail: m[2], migration });
  }
  return out;
}

/**
 * The declared parameter names of a function, from the text between its parentheses.
 *
 * `IN`/`OUT`/`INOUT` and a `DEFAULT` tail are dropped; what is left of each chunk
 * starts with the parameter name. A signature carrying a parenthesised type such as
 * `numeric(10,2)` would be cut short by the regex above and is not attempted here —
 * the probe then asks the wrong question and says so out loud, which is better than
 * answering it wrongly.
 */
export function paramNames(inside: string): string[] {
  return inside
    .split(",")
    .map((chunk) => chunk.trim().replace(/\s+default\s+[\s\S]*$/i, "").trim())
    .map((chunk) => chunk.replace(/^(in|out|inout|variadic)\s+/i, "").trim())
    .map((chunk) => chunk.split(/\s+/)[0] ?? "")
    .filter((name) => /^[a-z_][a-z0-9_]*$/i.test(name));
}

/**
 * The JSON body that asks for a function by the signature it was declared with.
 *
 * The values are null on purpose: PostgREST matches the overload on the KEYS, and a
 * function that exists then answers with its own error instead of `PGRST202` — which
 * is the only thing this probe is asking.
 */
export function probeBody(p: Probe): Record<string, null> {
  return Object.fromEntries((p.args ?? []).map((a) => [a, null]));
}

/** The PostgREST path that asks the question, relative to `/rest/v1/`. */
export function probePath(p: Probe, enumTable: Record<string, { table: string; column: string }>): string | null {
  switch (p.kind) {
    case "function": return `rpc/${p.name}`;
    case "column":   return `${p.table}?select=${p.detail}&limit=1`;
    case "table":    return `${p.name}?select=*&limit=1`;
    case "enum": {
      const where = enumTable[p.name];
      // An enum is only probeable through a table that carries it; without one
      // declared, say so rather than invent a path.
      return where ? `${where.table}?${where.column}=eq.${p.detail}&limit=1` : null;
    }
  }
}

/** Which error code means "this has not been applied", per shape. */
export const MISSING_CODE: Record<ProbeKind, string> = {
  function: "PGRST202",
  column: "42703",
  table: "PGRST205",
  enum: "22P02",
};
