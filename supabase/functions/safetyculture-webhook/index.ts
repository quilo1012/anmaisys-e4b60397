import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getAction, hasToken, parseAction } from "../_shared/safetyculture/client.ts";
import { adminClient, applyActions, log } from "../_shared/safetyculture/sync.ts";

/**
 * The event-driven half: SafetyCulture posts here when an Action changes, and the
 * record is written within seconds instead of at the next poll.
 *
 * The poller stays on as the safety net — a webhook that is never delivered, or a
 * delivery that fails while the database is briefly unreachable, is picked up by
 * the next incremental read. Both paths end in the same idempotent upsert, so an
 * Action arriving twice is written once.
 *
 * Authentication is a shared secret, because SafetyCulture cannot hold a session.
 * An UNSET secret refuses everything rather than comparing "" to "".
 */

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const secret = (Deno.env.get("SAFETYCULTURE_WEBHOOK_SECRET") ?? "").trim();
  if (!secret) {
    return json(
      { error: "server_misconfigured", message: "Webhook secret is not configured — refusing all requests." },
      503,
    );
  }
  const presented =
    req.headers.get("x-safetyculture-secret") ??
    req.headers.get("x-webhook-secret") ??
    new URL(req.url).searchParams.get("secret") ??
    "";
  if (presented !== secret) return json({ error: "unauthorized" }, 401);

  const db = adminClient();

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  try {
    // Deliveries vary: sometimes the whole Action, sometimes only its id.
    const raw = (body.action ?? body.data ?? body.task ?? body) as Record<string, unknown>;
    let action = parseAction(raw);

    const thin = !action?.title && !action?.modified_at;
    if (action && thin && hasToken()) {
      action = (await getAction(action.id)) ?? action;
    }

    if (!action) {
      await log(db, "api_error", { message: "Webhook payload carried no action id" });
      return json({ error: "no_action_id" }, 400);
    }

    const summary = await applyActions(db, [action]);
    return json({ ok: true, ...summary });
  } catch (e) {
    await log(db, "api_error", { message: (e as Error).message });
    // 200 would make SafetyCulture drop the event; a 5xx lets it retry, and the
    // poller would catch it anyway.
    return json({ error: "webhook_failed", message: (e as Error).message }, 500);
  }
});
