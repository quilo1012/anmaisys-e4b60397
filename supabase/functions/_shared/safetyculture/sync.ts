/**
 * The import itself: take Actions, decide what each one becomes, and write it once.
 *
 * Idempotent by construction. Every Action is looked up by `(source, external_id)`
 * before anything is written, so a second delivery of the same event updates the
 * record it already made instead of making a second one.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { buildRecord, londonDay, type ClassificationRule, type ScAction } from "./normalize.ts";
import type { Attendance } from "./classification.ts";
import { sessionInCharge, type ProductionSession } from "./leaderOnDuty.ts";
import { parseProductNote, resolveSkuFromNote } from "./productNote.ts";

export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

export type LogEvent =
  | "received"
  | "created"
  | "updated"
  | "skipped_duplicate"
  | "deleted"
  | "auth_error"
  | "api_error"
  | "classification_error"
  | "line_leader_error"
  | "rate_limited"
  | "timeout"
  | "sync_started"
  | "sync_finished";

/** Writes never carry the token: only ids, titles and messages reach this table. */
export async function log(
  db: SupabaseClient,
  event: LogEvent,
  fields: { action_id?: string; action_title?: string; message?: string; details?: unknown } = {},
) {
  await db.from("sc_sync_logs").insert({
    event,
    action_id: fields.action_id ?? null,
    action_title: fields.action_title ?? null,
    message: (fields.message ?? "").slice(0, 1000) || null,
    details: (fields.details ?? null) as never,
  });
}

export type LeaderSource = "session" | "session_unsigned" | "assignment" | "none";

export interface LeaderLookup {
  leader: { id: string; name: string } | null;
  source: LeaderSource;
}

export interface Context {
  lineNames: string[];
  rules: ClassificationRule[];
  /**
   * Who was running the line AT THAT MOMENT, and where the answer came from.
   *
   * `at` is an instant, not a day: nights start at 17:00 and run past midnight, so
   * the shift that owns an action raised at 02:23 opened the previous afternoon.
   */
  leaderAt: (line: string, at?: string | null) => LeaderLookup;
  /** The same answer without its provenance, for callers that only need the name. */
  leaderFor: (line: string, at?: string | null) => { id: string; name: string } | null;
  /** present | absent | unknown — never a boolean. See `classification.ts`. */
  attendance: (worker: string, day: string) => Attendance;
  countsAgainstLeader: (label: string) => boolean;
  requireWorkerEvidence: boolean;
  /** What a SafetyCulture priority UUID means. Empty until somebody maps them. */
  priorityOf: (id: string) => { name: string; severity: string | null } | null;
}

/**
 * A name written by a person, reduced to something two spellings of it share.
 *
 * Deliberately the same rule as `src/lib/leaderNameMatch` — case-folded and
 * whitespace-collapsed, nothing cleverer. It cannot be imported (that file is bundled
 * for the browser), so it is repeated here and nowhere else.
 */
function foldName(v: unknown): string {
  return String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * PostgREST caps a select at a thousand rows and says nothing about it. A silently
 * truncated attendance table reads as "nobody was recorded", which is exactly the
 * answer this module must not give by accident.
 */
/** Just enough of the PostgREST builder for the two calls made below. */
interface PagedQuery {
  gte(column: string, value: string): PagedQuery;
  range(
    from: number,
    to: number,
  ): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
}

async function fetchAll(
  db: SupabaseClient,
  table: string,
  columns: string,
  apply: (q: PagedQuery) => PagedQuery = (q) => q,
): Promise<Record<string, unknown>[]> {
  const page = 1000;
  const out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += page) {
    const query = apply(db.from(table).select(columns) as unknown as PagedQuery);
    const { data, error } = await query.range(from, from + page - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Record<string, unknown>[];
    out.push(...rows);
    if (rows.length < page) return out;
  }
}

/**
 * Lines, leaders, rules, attendance and label attribution — all from the database,
 * never from a list in the code.
 *
 * Loaded once per sync and answered in memory, because the alternative is a query per
 * action per question and the organisation holds thousands of actions.
 */
export async function loadContext(db: SupabaseClient): Promise<Context> {
  const since = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10);

  const [
    { data: lines },
    { data: leaders },
    { data: assignments },
    { data: rules },
    { data: attribution },
    { data: priorities },
    employees,
    attendanceRows,
    sessionRows,
  ] = await Promise.all([
    db.from("lines").select("id,name,active").eq("active", true),
    db.from("line_leaders").select("id,name,line,active").eq("active", true),
    db.from("leader_line_assignment").select("leader_id,line_id,valid_from,valid_to"),
    db.from("sc_classification_rules").select("*").eq("active", true),
    db.from("quality_label_attribution").select("label,counts_against_leader"),
    db.from("sc_priorities").select("priority_id,name,severity"),
    fetchAll(db, "employees", "id,full_name"),
    // Six months is as far back as a re-classification pass is ever asked to reach,
    // and it keeps the map small enough to hold.
    fetchAll(db, "employee_attendance", "employee_id,on_date,status", (q) =>
      q.gte("on_date", since)),
    // Who actually opened each line, each shift. The answer `leader_line_assignment`
    // could never give.
    fetchAll(db, "production_sessions", "line,session_date,shift,leader_name,started_at", (q) =>
      q.gte("session_date", since)),
  ]);

  const sessions = sessionRows as unknown as ProductionSession[];

  const lineById = new Map((lines ?? []).map((l) => [l.id as string, l.name as string]));
  const leaderById = new Map(
    (leaders ?? []).map((l) => [l.id as string, l.name as string]),
  );

  // The leader recorded on `line_leaders` is the standing answer; a dated assignment
  // overrides it for the window it covers.
  const standing = new Map<string, { id: string; name: string }>();
  for (const l of leaders ?? []) {
    const line = String((l as { line?: string }).line ?? "").trim();
    if (line && !standing.has(line.toLowerCase())) {
      standing.set(line.toLowerCase(), { id: l.id as string, name: l.name as string });
    }
  }

  const windows = (assignments ?? [])
    .map((a) => ({
      line: (lineById.get((a as { line_id: string }).line_id) ?? "").toLowerCase(),
      id: (a as { leader_id: string }).leader_id,
      name: leaderById.get((a as { leader_id: string }).leader_id) ?? "",
      from: (a as { valid_from?: string }).valid_from ?? null,
      to: (a as { valid_to?: string }).valid_to ?? null,
    }))
    .filter((w) => w.line && w.name);

  // A session records the leader by NAME only — `production_sessions.leader_id` is
  // null on every row in the table — so the name has to be resolved back to a leader.
  // Same rule as everywhere else here: fold the name, and accept it only when exactly
  // one leader answers to it.
  const leaderIdByName = new Map<string, string>();
  for (const l of leaders ?? []) {
    const key = foldName((l as { name?: string }).name);
    if (!key) continue;
    leaderIdByName.set(key, leaderIdByName.has(key) ? "" : (l.id as string));
  }

  /**
   * Who was running the line when the finding was raised.
   *
   * The open session comes first and the standing assignment is only a fallback,
   * because the standing assignment is what was getting this wrong: seven rows, all
   * open ended, so every action on a line came out in one name regardless of the day
   * or the shift — fourteen of twenty-two records, measured on 07/09/2026.
   *
   * A session that was opened and left unsigned deliberately does NOT fall through to
   * the assignment. Falling through is the bug.
   */
  const leaderAt = (line: string, at?: string | null): LeaderLookup => {
    const session = sessionInCharge(line, at ?? null, sessions);
    if (session) {
      const name = String(session.leader_name ?? "").trim();
      if (!name) return { leader: null, source: "session_unsigned" };
      const id = leaderIdByName.get(foldName(name));
      // A name no leader row answers to is still the truth about who ran the line.
      return { leader: { id: id || "", name }, source: "session" };
    }

    const key = line.trim().toLowerCase();
    const day = londonDay(at ?? null) ?? new Date().toISOString().slice(0, 10);
    const held = windows.find(
      (w) => w.line === key && (!w.from || w.from <= day) && (!w.to || w.to >= day),
    );
    if (held) return { leader: { id: held.id, name: held.name }, source: "assignment" };
    const standingLeader = standing.get(key);
    if (standingLeader) return { leader: standingLeader, source: "assignment" };
    return { leader: null, source: "none" };
  };

  const leaderFor = (line: string, at?: string | null) => leaderAt(line, at).leader;

  const employeeByName = new Map<string, string>();
  for (const e of employees) {
    const key = foldName((e as { full_name?: string }).full_name);
    // A name two people answer to cannot identify either of them, so it identifies
    // nobody — the lookup returns "unknown" rather than picking one.
    if (!key) continue;
    employeeByName.set(key, employeeByName.has(key) ? "" : (e.id as string));
  }

  const PRESENT = new Set(["present", "training"]);
  const AWAY = new Set(["absent", "sick", "holiday"]);
  const byEmployeeDay = new Map<string, string>();
  for (const r of attendanceRows) {
    byEmployeeDay.set(
      `${r.employee_id as string}|${String(r.on_date).slice(0, 10)}`,
      String(r.status ?? ""),
    );
  }

  /**
   * Three answers, and the third one is the common one.
   *
   * A SafetyCulture assignee is often a mailbox ("Quality Control", "Supervisors")
   * that no employee row will ever match, and `employee_attendance` has gaps of whole
   * days. Both of those are "unknown", which reports; only a recorded absence is
   * "absent", which blocks.
   */
  const attendance = (worker: string, day: string): Attendance => {
    const id = employeeByName.get(foldName(worker));
    if (!id) return "unknown";
    const status = byEmployeeDay.get(`${id}|${day}`);
    if (!status) return "unknown";
    if (PRESENT.has(status)) return "present";
    if (AWAY.has(status)) return "absent";
    return "unknown";
  };

  // Anything not listed counts, which is what the table's own comment says: a new
  // label has to be excluded on purpose so nothing quietly stops counting.
  const excluded = new Set(
    (attribution ?? [])
      .filter((r) => (r as { counts_against_leader?: boolean }).counts_against_leader === false)
      .map((r) => foldName((r as { label?: string }).label)),
  );

  return {
    lineNames: (lines ?? []).map((l) => l.name as string).filter(Boolean),
    rules: (rules ?? []) as unknown as ClassificationRule[],
    leaderAt,
    leaderFor,
    attendance,
    countsAgainstLeader: (label: string) => !excluded.has(foldName(label)),
    priorityOf: (id: string) => {
      const row = (priorities ?? []).find(
        (p) => (p as { priority_id?: string }).priority_id === id,
      ) as { name?: string; severity?: string | null } | undefined;
      return row?.name ? { name: row.name, severity: row.severity ?? null } : null;
    },
    // Off while `employee_attendance` is filled in only some days: switching it on
    // today would send every action of the last three days to review.
    requireWorkerEvidence: false,
  };
}

export interface UpsertResult {
  outcome: "created" | "updated" | "unchanged";
  problems: string[];
}

/**
 * One Action → one record. `category` and `error_type` live on the record so the
 * Quality screen can show what SafetyCulture said even when no rule matched.
 */
export async function upsertAction(
  db: SupabaseClient,
  action: ScAction,
  ctx: Context,
): Promise<UpsertResult> {
  const { draft, problems } = buildRecord(action, ctx);

  const { data: existing, error: findErr } = await db
    .from("quality_actions")
    .select("id, external_updated_at, closed_at, validation_status, sku, batch")
    .eq("source", "safetyculture")
    .eq("external_id", action.id)
    .maybeSingle();
  if (findErr) throw findErr;

  const identity = (await identifyProducts(db, [{ draft }])).get(draft.external_id);
  // The columns an imported record owns, from the one place that lists them. Only a
  // row carrying neither SKU nor batch takes the note's word for it — see `rowFor`.
  const blank = !existing || (!String(existing.sku ?? "").trim() && !String(existing.batch ?? "").trim());
  const payload = rowFor(draft, blank ? identity : undefined);

  if (!existing) {
    const { error } = await db.from("quality_actions").insert(payload);
    if (error) throw error;
    await log(db, "created", {
      action_id: action.id,
      action_title: action.title,
      message: draft.line ? `Line ${draft.line}` : "No line identified",
      details: { problems },
    });
    return { outcome: "created", problems };
  }

  if (
    existing.external_updated_at &&
    draft.external_updated_at &&
    existing.external_updated_at === draft.external_updated_at
  ) {
    await db
      .from("quality_actions")
      .update({ last_synced_at: draft.last_synced_at })
      .eq("id", existing.id);
    await log(db, "skipped_duplicate", { action_id: action.id, action_title: action.title });
    return { outcome: "unchanged", problems };
  }

  // A manual correction is respected: once someone has classified the record, a
  // later sync does not push it back into "needs classification".
  const update = existing.validation_status && existing.validation_status !== "open"
    ? { ...payload, needs_classification: false }
    : payload;

  const { error } = await db.from("quality_actions").update(update).eq("id", existing.id);
  if (error) throw error;
  await log(db, action.deleted ? "deleted" : "updated", {
    action_id: action.id,
    action_title: action.title,
    details: { problems },
  });
  return { outcome: "updated", problems };
}

export interface SyncSummary {
  created: number;
  updated: number;
  unchanged: number;
  errors: number;
  needs_classification: number;
  cursor: string | null;
}

/** What the note said, once the batch has been looked up. */
interface ProductIdentity {
  /** A catalogue code, or null when the batch alone does not name one. */
  sku: string | null;
  batch: string;
}

/**
 * The product and batch an operator wrote into the Action's description.
 *
 * A SafetyCulture Action has no product field. The people raising them write it
 * into the free text instead, as `Product / BATCH / best-before`, and until now the
 * sync copied that sentence into `description` and stopped — so `sku` and `batch`
 * stayed NULL on every one of the 106 rows imported since 01/09/2026, and the
 * Quality screen, the PDF and the workbook all printed empty columns about actions
 * whose product was written down in as many words.
 *
 * The middle token is a BATCH, not a SKU: `production_items` says A26213 was run as
 * both CRE250 and CRE500. So the batch gives the candidates and the operator's own
 * words break the tie — see `resolveSkuFromNote`. A tie the words do not break
 * leaves `sku` null and keeps the batch, because the batch is not in doubt.
 *
 * Two queries for the whole page, never one per Action: a round trip per row is
 * what exhausted the worker on the first full read.
 */
async function identifyProducts(
  db: SupabaseClient,
  drafts: { draft: { external_id: string; description: string | null } }[],
): Promise<Map<string, ProductIdentity>> {
  const notes = new Map<string, { product: string; batch: string }>();
  for (const { draft } of drafts) {
    const note = parseProductNote(draft.description);
    if (note) notes.set(draft.external_id, note);
  }
  if (notes.size === 0) return new Map();

  const batches = Array.from(new Set(Array.from(notes.values()).map((n) => n.batch)));
  const { data: items } = await db
    .from("production_items").select("batch_code, sku_id").in("batch_code", batches);
  const rows = ((items ?? []) as { batch_code: string | null; sku_id: string | null }[])
    .filter((r): r is { batch_code: string; sku_id: string } => !!r.batch_code && !!r.sku_id);

  const byBatch = new Map<string, { code: string; name: string }[]>();
  if (rows.length) {
    const { data: skus } = await db
      .from("sku_products").select("id, code, name")
      .in("id", Array.from(new Set(rows.map((r) => r.sku_id))));
    const byId = new Map(
      ((skus ?? []) as { id: string; code: string; name: string }[]).map((p) => [p.id, p]),
    );
    for (const r of rows) {
      const p = byId.get(r.sku_id);
      if (!p?.code) continue;
      const key = r.batch_code.trim().toUpperCase();
      const list = byBatch.get(key) ?? [];
      if (!list.some((c) => c.code === p.code)) list.push({ code: p.code, name: p.name });
      byBatch.set(key, list);
    }
  }

  const out = new Map<string, ProductIdentity>();
  for (const [externalId, note] of notes) {
    out.set(externalId, {
      sku: resolveSkuFromNote(note, byBatch.get(note.batch) ?? []),
      batch: note.batch,
    });
  }
  return out;
}

/**
 * Applies one page in a handful of queries instead of one per Action.
 *
 * The organisation holds thousands of Actions, and a round trip per row — a
 * lookup, a write and a log line each — is what exhausted the worker on the
 * first full read. Here the page is looked up in one query, the new rows are
 * inserted in one statement, and only genuinely changed rows are written
 * individually. Per-Action logging is reserved for failures; the successes are
 * counted, not narrated.
 */
export async function applyActions(
  db: SupabaseClient,
  actions: ScAction[],
  context?: Context,
): Promise<SyncSummary> {
  const ctx = context ?? (await loadContext(db));
  const summary: SyncSummary = {
    created: 0,
    updated: 0,
    unchanged: 0,
    errors: 0,
    needs_classification: 0,
    cursor: null,
  };
  if (!actions.length) return summary;

  const drafts = actions.map((a) => ({ action: a, ...buildRecord(a, ctx) }));
  const identities = await identifyProducts(db, drafts);

  // `sku, batch` are read back so an update can tell a row that has never carried a
  // product from one somebody has already filled in by hand.
  const { data: existingRows, error: findErr } = await db
    .from("quality_actions")
    .select("id, external_id, external_updated_at, validation_status, sku, batch")
    .eq("source", "safetyculture")
    .in("external_id", actions.map((a) => a.id));
  if (findErr) throw findErr;

  const existing = new Map(
    (existingRows ?? []).map((r) => [r.external_id as string, r]),
  );

  const toInsert: Record<string, unknown>[] = [];

  for (const { action, draft, problems } of drafts) {
    if (problems.length) summary.needs_classification++;
    if (action.modified_at && (!summary.cursor || action.modified_at > summary.cursor)) {
      summary.cursor = action.modified_at;
    }

    const identity = identities.get(draft.external_id);
    const prev = existing.get(action.id);

    if (!prev) {
      toInsert.push(rowFor(draft, identity));
      continue;
    }
    // Only a row with neither takes the note's word for it. See `rowFor`.
    const blank = !String(prev.sku ?? "").trim() && !String(prev.batch ?? "").trim();

    if (
      prev.external_updated_at &&
      draft.external_updated_at &&
      prev.external_updated_at === draft.external_updated_at
    ) {
      // Nothing changed at SafetyCulture's end — but the rows imported before this
      // function learned to read a product note still carry NULL in both columns,
      // and SafetyCulture will never touch them again, so no later sync would ever
      // reach them. A re-read of the period (`full`, or `since`) heals them here,
      // by the same resolver that fills a new row, and writes nothing else.
      if (blank && identity) {
        const { error } = await db
          .from("quality_actions")
          .update({ sku: identity.sku, batch: identity.batch })
          .eq("id", prev.id);
        if (error) {
          summary.errors++;
        } else {
          summary.updated++;
          continue;
        }
      }
      summary.unchanged++;
      continue;
    }

    const payload = rowFor(draft, blank ? identity : undefined);

    // A manual correction is respected: once someone has classified the record,
    // a later sync does not push it back into "needs classification".
    const update = prev.validation_status && prev.validation_status !== "open"
      ? { ...payload, needs_classification: false, classification_status: "classified" }
      : payload;

    const { error } = await db.from("quality_actions").update(update).eq("id", prev.id);
    if (error) {
      summary.errors++;
      await log(db, "api_error", {
        action_id: action.id,
        action_title: action.title,
        message: error.message,
      });
      continue;
    }
    summary.updated++;
  }

  if (toInsert.length) {
    const { error } = await db.from("quality_actions").insert(toInsert);
    if (error) {
      // One bad row must not lose the other ninety-nine: fall back to row by row.
      for (const row of toInsert) {
        const { error: e2 } = await db.from("quality_actions").insert(row);
        if (e2) {
          summary.errors++;
          await log(db, "api_error", {
            action_id: String(row.external_id ?? ""),
            action_title: String(row.title ?? ""),
            message: e2.message,
          });
        } else summary.created++;
      }
    } else {
      summary.created += toInsert.length;
    }
  }

  return summary;
}

/**
 * The columns an imported record owns. Everything else belongs to the PM System.
 *
 * `sku` and `batch` are the exception that proves the rule: they belong to the PM
 * System, and the sync fills them only when they are EMPTY — never on an update to
 * a row that already carries one. Someone who corrects a SKU by hand must not find
 * it rewritten on the hour, which is exactly what happened to `validation_status`
 * once already. The caller decides; `identity` is simply absent when it must not.
 */
function rowFor(
  draft: ReturnType<typeof buildRecord>["draft"],
  identity?: ProductIdentity,
): Record<string, unknown> {
  return {
    ...(identity ? { sku: identity.sku, batch: identity.batch } : {}),
    source: draft.source,
    external_id: draft.external_id,
    external_url: draft.external_url,
    external_status: draft.external_status,
    external_priority: draft.external_priority,
    external_priority_id: draft.external_priority_id,
    action_no: draft.action_no,
    external_updated_at: draft.external_updated_at,
    external_created_at: draft.external_created_at,
    external_deleted_at: draft.external_deleted_at,
    external_site: draft.external_site,
    external_asset: draft.external_asset,
    external_template: draft.external_template,
    external_assignees: draft.external_assignees,
    title: draft.title,
    description: draft.description,
    assignee_name: draft.assignee_name,
    due_date: draft.due_date,
    recorded_at: draft.recorded_at,
    status: draft.status,
    line: draft.line,
    leader_id: draft.leader_id,
    leader_name: draft.leader_name,
    error_type: draft.error_type,
    department: draft.department,
    labels: draft.labels,
    severity: draft.severity,
    domain: draft.domain,
    needs_classification: draft.needs_classification,
    classification_status: draft.classification_status,
    classification: draft.classification,
    classification_checks: draft.classification_checks,
    classification_reasons: draft.classification_reasons,
    matched_rule_ids: draft.matched_rule_ids,
    matched_rule_names: draft.matched_rule_names,
    classified_at: draft.classified_at,
    last_synced_at: draft.last_synced_at,
  };
}

export async function bumpState(
  db: SupabaseClient,
  patch: Record<string, unknown>,
) {
  await db.from("sc_sync_state").update(patch).eq("id", true);
}
