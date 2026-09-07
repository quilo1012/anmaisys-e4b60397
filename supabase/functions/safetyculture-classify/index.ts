import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";
import { classify, resolveLine, type ScAction } from "../_shared/safetyculture/normalize.ts";
import { classifyAction } from "../_shared/safetyculture/classification.ts";
import { adminClient, loadContext, log } from "../_shared/safetyculture/sync.ts";

/**
 * Re-runs the classification rules over records already imported from
 * SafetyCulture, without touching the API.
 *
 * Nothing is invented: a record only leaves "needs review" when the rules give it
 * an error type and either a line with a leader, or an area (department) that is
 * outside the production lines.
 */

const BodySchema = z.object({
  /** "pending" (default) only revisits records still awaiting classification. */
  scope: z.enum(["pending", "all"]).default("pending"),
  limit: z.number().int().min(1).max(2000).default(1000),
});

const ALLOWED = ["admin", "manager", "quality_supervisor", "maintenance_manager"];

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function callerIsAllowed(req: Request): Promise<boolean> {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return false;
  const authClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: claims, error } = await authClient.auth.getClaims(
    authHeader.replace("Bearer ", ""),
  );
  if (error || !claims?.claims?.sub) return false;
  const userId = claims.claims.sub as string;
  const db = adminClient();
  const { data: roles } = await db.from("user_roles").select("role").eq("user_id", userId);
  if ((roles ?? []).some((r: { role: string }) => ALLOWED.includes(r.role))) return true;
  const { data: owner } = await db.rpc("is_owner", { _uid: userId });
  return owner === true;
}

interface Row {
  id: string;
  external_id: string;
  title: string | null;
  description: string | null;
  labels: string[] | null;
  external_site: string | null;
  external_asset: string | null;
  external_template: string | null;
  external_priority: string | null;
  line: string | null;
  leader_id: string | null;
  department: string | null;
  error_type: string | null;
  external_created_at: string | null;
  due_date: string | null;
  external_assignees: string[] | null;
  assignee_name: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!(await callerIsAllowed(req))) return json({ error: "Not allowed" }, 403);

  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return json({ error: parsed.error.flatten().fieldErrors }, 400);
  }
  const { scope, limit } = parsed.data;

  const db = adminClient();
  const ctx = await loadContext(db);

  let query = db
    .from("quality_actions")
    .select(
      "id,external_id,title,description,labels,external_site,external_asset,external_template,external_priority,line,leader_id,department,error_type,external_created_at,due_date,external_assignees,assignee_name",
    )
    .eq("source", "safetyculture")
    .order("external_created_at", { ascending: false })
    .limit(limit);
  if (scope === "pending") {
    // A record the migration left NULL has never been through the gates at all, so
    // "pending" has to mean "not settled" rather than "already marked for review".
    query = query.or("classification.is.null,classification.eq.needs_review");
  }

  const { data, error } = await query;
  if (error) return json({ error: error.message }, 500);

  const rows = (data ?? []) as unknown as Row[];
  let classified = 0;
  let stillPending = 0;
  let updated = 0;

  for (const row of rows) {
    const action: ScAction = {
      id: row.external_id,
      title: row.title ?? "",
      description: row.description,
      labels: row.labels ?? [],
      site: row.external_site,
      asset: row.external_asset,
      template: row.external_template,
      priority: row.external_priority,
      created_at: row.external_created_at,
      due_at: row.due_date,
    };

    const line = resolveLine(action, ctx.lineNames, ctx.rules) ?? row.line ?? null;
    // Asked about the instant, not the day: the shift that owns an action raised at
    // 02:23 opened the previous afternoon.
    const lookup = line
      ? ctx.leaderAt(line, row.external_created_at)
      : { leader: null, source: "none" as const };
    const leader = lookup.leader;
    const cls = classify(action, ctx.rules);
    const errorType = cls.error_type ?? row.error_type ?? null;
    const department = cls.department ?? row.department ?? null;

    const workers = row.external_assignees?.length
      ? row.external_assignees
      : (row.assignee_name ?? "").split(",").map((w) => w.trim()).filter(Boolean);

    const verdict = classifyAction(
      {
        site: row.external_site,
        actionDate: row.external_created_at,
        dueDate: row.due_date,
        line,
        leader,
        leaderSource: lookup.source,
        errorType,
        department,
        labels: row.labels ?? [],
        workers,
        title: row.title,
        description: row.description,
        priority: row.external_priority,
        asset: row.external_asset,
        template: row.external_template,
      },
      ctx.rules
        .filter((r) => Boolean(r.id))
        .map((r) => ({
          id: r.id as string,
          name: r.name ?? null,
          match_field: r.match_field,
          match_key: r.match_key ?? null,
          match_value: r.match_value,
          match_mode: r.match_mode,
          classification: r.classification ?? null,
          priority: r.priority,
          active: r.active,
        })),
      {
        attendance: ctx.attendance,
        countsAgainstLeader: ctx.countsAgainstLeader,
        requireWorkerEvidence: ctx.requireWorkerEvidence,
      },
    );

    // "Classified" now means the record survived every gate, not merely that some
    // rule put a label on it.
    const complete = verdict.classification !== "needs_review";
    if (complete) classified++;
    else stillPending++;

    const payload = {
      line,
      leader_id: leader?.id ?? null,
      leader_name: leader?.name ?? null,
      error_type: errorType,
      department,
      severity: cls.severity ?? undefined,
      classification: verdict.classification,
      classification_checks: verdict.checks,
      classification_reasons: verdict.reasons,
      matched_rule_ids: verdict.matched_rule_ids,
      matched_rule_names: verdict.matched_rule_names,
      classified_at: new Date().toISOString(),
      needs_classification: !complete,
      classification_status: complete ? "classified" : "needs_review",
    };

    const { error: upErr } = await db.from("quality_actions").update(payload).eq("id", row.id);
    if (upErr) {
      await log(db, "classification_error", {
        action_id: row.external_id,
        action_title: row.title ?? undefined,
        message: upErr.message,
      });
      continue;
    }
    updated++;
  }

  await log(db, "sync_finished", {
    message: `Classification pass: ${classified} classified, ${stillPending} still to review`,
    details: { scope, examined: rows.length },
  });

  // Keep the monitor's counters truthful after a manual pass.
  const { count: pending } = await db
    .from("quality_actions")
    .select("id", { count: "exact", head: true })
    .eq("source", "safetyculture")
    .eq("classification_status", "needs_review");
  await db
    .from("sc_sync_state")
    .update({ actions_needs_review: pending ?? 0 })
    .eq("id", true);

  return json({ examined: rows.length, updated, classified, needs_review: stillPending });
});
