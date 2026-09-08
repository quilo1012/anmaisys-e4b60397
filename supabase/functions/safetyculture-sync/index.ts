import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";
import {
  hasToken,
  listActionsPage,
  orgId,
  ScApiError,
  ScAuthError,
  ScRateLimit,
  ScTimeout,
  testConnection,
} from "../_shared/safetyculture/client.ts";
import {
  adminClient,
  applyActions,
  bumpState,
  loadContext,
  log,
} from "../_shared/safetyculture/sync.ts";

/**
 * Pulls Actions from SafetyCulture into the Quality log.
 *
 * Three callers, three gates:
 *   - a signed-in admin pressing "Sync now" or "Test connection"
 *   - the scheduler, holding CRON_SECRET
 *   - nobody else
 *
 * The API token never leaves this process: it is read inside the client module
 * and no branch below returns, logs or reflects it.
 */

const BodySchema = z.object({
  mode: z.enum(["sync", "test", "status"]).default("sync"),
  /** Ignore the stored cursor and re-read from this instant. */
  since: z.string().datetime().optional(),
  full: z.boolean().optional(),
});

const ALLOWED = ["admin", "manager", "quality_supervisor", "maintenance_manager"];

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** True only for a signed-in user holding one of the roles above, or the owner. */
async function callerIsAllowed(req: Request): Promise<boolean> {
  // The scheduler's secret has three possible names in this project; a job written
  // against one of them must not fail silently because the function read another.
  const cronSecrets = ["CRON_SECRET", "CRON_TRIGGER_TOKEN", "CRON_POLL_KEY"]
    .map((n) => (Deno.env.get(n) ?? "").trim())
    .filter(Boolean);
  const presented = (req.headers.get("x-cron-secret") ?? "").trim();
  if (presented && cronSecrets.includes(presented)) return true;

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!(await callerIsAllowed(req))) return json({ error: "unauthorized" }, 401);

  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return json({ error: "invalid_body", details: parsed.error.flatten().fieldErrors }, 400);
  }
  const { mode, since, full } = parsed.data;
  const db = adminClient();

  if (mode === "status") {
    const { data: state } = await db.from("sc_sync_state").select("*").eq("id", true).maybeSingle();
    return json({
      ok: true,
      configured: hasToken(),
      organization_id: orgId() || null, // an id, not a credential
      state,
    });
  }

  if (!hasToken()) {
    return json({ error: "not_configured", message: "SafetyCulture API token is not set." }, 400);
  }

  if (mode === "test") {
    try {
      const res = await testConnection();
      return json({ ok: true, ...res, organization_id: orgId() || null });
    } catch (e) {
      const status = e instanceof ScAuthError ? 401 : 502;
      await log(db, e instanceof ScAuthError ? "auth_error" : "api_error", {
        message: (e as Error).message,
      });
      return json({ error: "test_failed", message: (e as Error).message }, status);
    }
  }

  const startedAt = new Date().toISOString();
  await bumpState(db, { last_attempt_at: startedAt });
  await log(db, "sync_started", { message: full ? "full re-read" : "incremental" });

  try {
    const { data: state } = await db
      .from("sc_sync_state")
      .select("cursor_modified_after, enabled, import_from")
      .eq("id", true)
      .maybeSingle();

    if (state?.enabled === false) {
      return json({ ok: true, skipped: "integration disabled" });
    }

    const { data: full_state } = await db
      .from("sc_sync_state")
      .select("page_token, backfill_complete")
      .eq("id", true)
      .maybeSingle();

    // SafetyCulture has no "modified since" filter and its sort hint is not
    // honoured, so the only reliable reconciliation is a rolling sweep: each run
    // continues from the page the last one stopped at, and starts over once the
    // list is exhausted. Unchanged rows cost nothing — they are matched in one
    // query per page and skipped. Live changes arrive on the webhook; this is the
    // backstop that catches whatever the webhook missed.
    const cursor = full ? null : (since ?? null);

    // First phase: only Actions raised on or after this instant are imported.
    // The date is configuration, not code — it lives on `sc_sync_state`.
    const importFrom = (state as { import_from?: string } | null)?.import_from ??
      "2026-09-01T00:00:00Z";

    const ctx = await loadContext(db);
    let found = 0;
    let ignored = 0;
    let pageToken: string | null = full ? null : (full_state?.page_token ?? null);
    let read = 0;
    let newest: string | null = state?.cursor_modified_after ?? null;
    const totals = { created: 0, updated: 0, unchanged: 0, errors: 0, needs_classification: 0 };

    // A page budget keeps one invocation inside the worker's time and memory.
    const PAGES = 12;
    let page = 0;
    for (; page < PAGES; page++) {
      const res = await listActionsPage(pageToken);
      read += res.actions.length;
      const inWindow = res.actions.filter((a) => {
        const raised = a.created_at ?? a.modified_at ?? null;
        return !!raised && raised >= importFrom;
      });
      ignored += res.actions.length - inWindow.length;
      found += inWindow.length;
      const wanted = cursor
        ? inWindow.filter((a) => !a.modified_at || a.modified_at > cursor)
        : inWindow;

      const summary = await applyActions(db, wanted, ctx);
      totals.created += summary.created;
      totals.updated += summary.updated;
      totals.unchanged += summary.unchanged;
      totals.errors += summary.errors;
      totals.needs_classification += summary.needs_classification;
      if (summary.cursor && (!newest || summary.cursor > newest)) newest = summary.cursor;

      pageToken = res.nextToken;
      if (!pageToken) break;
    }

    const finished = !pageToken;

    await bumpState(db, {
      last_success_at: new Date().toISOString(),
      last_error: null,
      cursor_modified_after: finished ? newest : (state?.cursor_modified_after ?? null),
      page_token: finished ? null : pageToken,
      backfill_complete: finished ? true : (full_state?.backfill_complete ?? false),
      actions_imported: totals.created,
      actions_updated: totals.updated,
      actions_skipped: totals.unchanged,
      error_count: totals.errors,
      actions_found: found,
      actions_ignored: ignored,
      actions_needs_review: totals.needs_classification,
      window_start: importFrom,
      window_end: new Date().toISOString(),
    });
    await log(db, "sync_finished", {
      message: `${read} action(s) read over ${page + 1} page(s)${finished ? "" : " — more to follow"}`,
      details: totals,
    });

    return json({ ok: true, read, found, ignored, finished, ...totals });
  } catch (e) {
    const err = e as Error;
    const event = e instanceof ScAuthError
      ? "auth_error"
      : e instanceof ScRateLimit
      ? "rate_limited"
      : e instanceof ScTimeout
      ? "timeout"
      : "api_error";
    await log(db, event, { message: err.message });
    await bumpState(db, { last_error: err.message.slice(0, 500) });
    const status = e instanceof ScAuthError ? 401 : e instanceof ScApiError ? e.status : 502;
    return json({ error: event, message: err.message }, status);
  }
});
