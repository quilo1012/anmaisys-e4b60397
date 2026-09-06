/**
 * The import itself: take Actions, decide what each one becomes, and write it once.
 *
 * Idempotent by construction. Every Action is looked up by `(source, external_id)`
 * before anything is written, so a second delivery of the same event updates the
 * record it already made instead of making a second one.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { buildRecord, type ClassificationRule, type ScAction } from "./normalize.ts";

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

export interface Context {
  lineNames: string[];
  rules: ClassificationRule[];
  leaderFor: (line: string) => { id: string; name: string } | null;
}

/** Lines and leaders come from the database, never from a list in the code. */
export async function loadContext(db: SupabaseClient): Promise<Context> {
  const [{ data: lines }, { data: leaders }, { data: assignments }, { data: rules }] =
    await Promise.all([
      db.from("lines").select("id,name,active").eq("active", true),
      db.from("line_leaders").select("id,name,line,active").eq("active", true),
      db.from("leader_line_assignment").select("leader_id,line_id,valid_from,valid_to"),
      db.from("sc_classification_rules").select("*").eq("active", true),
    ]);

  const lineById = new Map((lines ?? []).map((l) => [l.id as string, l.name as string]));
  const leaderById = new Map(
    (leaders ?? []).map((l) => [l.id as string, l.name as string]),
  );

  // Current assignments win; the leader recorded on `line_leaders` is the fallback.
  const today = new Date().toISOString().slice(0, 10);
  const byLine = new Map<string, { id: string; name: string }>();
  for (const l of leaders ?? []) {
    const line = String((l as { line?: string }).line ?? "").trim();
    if (line && !byLine.has(line.toLowerCase())) {
      byLine.set(line.toLowerCase(), { id: l.id as string, name: l.name as string });
    }
  }
  for (const a of assignments ?? []) {
    const from = (a as { valid_from?: string }).valid_from ?? null;
    const to = (a as { valid_to?: string }).valid_to ?? null;
    if (from && from > today) continue;
    if (to && to < today) continue;
    const lineName = lineById.get((a as { line_id: string }).line_id);
    const leaderName = leaderById.get((a as { leader_id: string }).leader_id);
    if (lineName && leaderName) {
      byLine.set(lineName.toLowerCase(), {
        id: (a as { leader_id: string }).leader_id,
        name: leaderName,
      });
    }
  }

  return {
    lineNames: (lines ?? []).map((l) => l.name as string).filter(Boolean),
    rules: (rules ?? []) as unknown as ClassificationRule[],
    leaderFor: (line: string) => byLine.get(line.trim().toLowerCase()) ?? null,
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
    .select("id, external_updated_at, closed_at, validation_status")
    .eq("source", "safetyculture")
    .eq("external_id", action.id)
    .maybeSingle();
  if (findErr) throw findErr;

  // The columns an imported record owns. Everything else on the row — the verdict
  // Quality gave it, its closure, its frozen points — belongs to the PM System and
  // is never overwritten by a sync.
  const payload = {
    source: draft.source,
    external_id: draft.external_id,
    external_url: draft.external_url,
    external_status: draft.external_status,
    external_priority: draft.external_priority,
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
    last_synced_at: draft.last_synced_at,
  };

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

  const { data: existingRows, error: findErr } = await db
    .from("quality_actions")
    .select("id, external_id, external_updated_at, validation_status")
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

    const payload = rowFor(draft);
    const prev = existing.get(action.id);

    if (!prev) {
      toInsert.push(payload);
      continue;
    }
    if (
      prev.external_updated_at &&
      draft.external_updated_at &&
      prev.external_updated_at === draft.external_updated_at
    ) {
      summary.unchanged++;
      continue;
    }

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

/** The columns an imported record owns. Everything else belongs to the PM System. */
function rowFor(draft: ReturnType<typeof buildRecord>["draft"]): Record<string, unknown> {
  return {
    source: draft.source,
    external_id: draft.external_id,
    external_url: draft.external_url,
    external_status: draft.external_status,
    external_priority: draft.external_priority,
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
    last_synced_at: draft.last_synced_at,
  };
}

export async function bumpState(
  db: SupabaseClient,
  patch: Record<string, unknown>,
) {
  await db.from("sc_sync_state").update(patch).eq("id", true);
}
