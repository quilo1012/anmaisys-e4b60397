import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MIN_DAYS = 90;
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-sonnet-5-5";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "unauthorized" }, 401);
    }
    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: claimsData, error: claimsErr } = await authClient.auth.getClaims(
      authHeader.replace("Bearer ", ""),
    );
    if (claimsErr || !claimsData?.claims?.sub) {
      return json({ error: "unauthorized" }, 401);
    }
    const userId = claimsData.claims.sub as string;


    const body = await req.json().catch(() => ({}));
    const skuId: string | undefined = body?.sku_id;
    const line: string | undefined = body?.line;
    if (!skuId || !line) return json({ error: "sku_id and line are required" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Authorization: cross-line analytics is limited to management roles.
    // Everyone else may only analyse lines they are assigned to.
    const PRIVILEGED = [
      "admin",
      "manager",
      "supervisor",
      "planner",
      "production_office_admin",
      "maintenance_manager",
    ];
    const { data: roleRows } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
    const privileged = roles.some((r) => PRIVILEGED.includes(r));

    if (!privileged) {
      const { data: lineNames } = await authClient.rpc("current_user_line_names");
      const allowed = ((lineNames as string[] | null) ?? []).map((l) => String(l).toLowerCase());
      if (!allowed.includes(line.toLowerCase())) {
        return json({ error: "forbidden" }, 403);
      }
    }


    // Load all history for this SKU on this line
    const { data: items, error: itemsErr } = await admin
      .from("production_items")
      .select("actual_qty, planned_qty, target_qty, production_sessions!inner(session_date, line, shift, leader_name)")
      .eq("sku_id", skuId)
      .eq("production_sessions.line", line);

    if (itemsErr) return json({ error: itemsErr.message }, 500);

    const rows = (items ?? []) as Array<{
      actual_qty: number | null;
      planned_qty: number | null;
      target_qty: number | null;
      production_sessions: { session_date: string; line: string; shift: string; leader_name: string | null } | null;
    }>;

    const dates = rows
      .map((r) => r.production_sessions?.session_date)
      .filter((d): d is string => !!d)
      .sort();

    const firstDate = dates[0];
    const lastDate = dates[dates.length - 1];
    const distinctDays = new Set(dates).size;

    let daysSpan = 0;
    if (firstDate && lastDate) {
      daysSpan = Math.floor(
        (new Date(lastDate).getTime() - new Date(firstDate).getTime()) / 86_400_000,
      ) + 1;
    }

    if (daysSpan < MIN_DAYS) {
      return json({
        available: false,
        days_recorded: daysSpan,
        distinct_days: distinctDays,
        days_remaining: Math.max(0, MIN_DAYS - daysSpan),
        min_days: MIN_DAYS,
        first_date: firstDate ?? null,
        last_date: lastDate ?? null,
      });
    }

    // Aggregate stats for the model
    const byShift: Record<string, { actual: number; planned: number; sessions: number }> = {};
    let totalActual = 0;
    let totalPlanned = 0;
    for (const r of rows) {
      const sh = r.production_sessions?.shift ?? "?";
      byShift[sh] ??= { actual: 0, planned: 0, sessions: 0 };
      const a = Number(r.actual_qty ?? 0);
      const p = Number(r.planned_qty ?? r.target_qty ?? 0);
      byShift[sh].actual += a;
      byShift[sh].planned += p;
      byShift[sh].sessions += 1;
      totalActual += a;
      totalPlanned += p;
    }

    // SKU name for context
    const { data: sku } = await admin
      .from("sku_products")
      .select("code, name")
      .eq("id", skuId)
      .maybeSingle();

    const efficiency = totalPlanned > 0 ? (totalActual / totalPlanned) * 100 : 0;

    const summary = {
      sku: sku ? `${sku.code} — ${sku.name}` : skuId,
      line,
      period: { first_date: firstDate, last_date: lastDate, days_span: daysSpan, distinct_days: distinctDays },
      totals: { actual: totalActual, planned: totalPlanned, efficiency_pct: Number(efficiency.toFixed(1)) },
      by_shift: byShift,
      session_count: rows.length,
    };

    const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_KEY) return json({ error: "ANTHROPIC_API_KEY missing" }, 500);

    const resp = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system:
          "You are a manufacturing performance analyst. Given historical production data for a single SKU on a single production line, produce a concise executive analysis (max 250 words). Structure: 1) Overall performance summary, 2) Shift-level insights, 3) Trends or anomalies, 4) 2-3 actionable recommendations. Use plain text with short paragraphs and bullet points where useful. Be specific with numbers.",
        messages: [
          {
            role: "user",
            content: `Analyze this SKU-line historical performance:\n\n${JSON.stringify(summary, null, 2)}`,
          },
        ],
      }),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      if (resp.status === 429) return json({ error: "AI rate limit exceeded, try again shortly." }, 429);
      if (resp.status === 401 || resp.status === 403) {
        return json({ error: "AI key rejected — check ANTHROPIC_API_KEY and billing." }, 502);
      }
      return json({ error: `AI error: ${txt.slice(0, 300)}` }, 502);
    }

    const aiJson = await resp.json();
    const analysis: string = extractText(aiJson);

    return json({
      available: true,
      days_recorded: daysSpan,
      distinct_days: distinctDays,
      min_days: MIN_DAYS,
      summary,
      analysis,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

/** A resposta do Claude vem em content[]; o texto está nos blocos de type "text". */
function extractText(aiJson: unknown): string {
  const blocks = (aiJson as { content?: Array<{ type?: string; text?: string }> })?.content;
  if (!Array.isArray(blocks)) return "";
  return blocks
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
