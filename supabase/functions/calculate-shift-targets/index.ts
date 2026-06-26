// Auto-calculates target_qty per SKU in production_items based on the SKU's
// UPM standard (sku_products.target_per_hour, treated as units-per-minute) and
// the 660 min available per shift, splitting time evenly across the SKUs
// scheduled for that line+shift+date. Then refreshes rag_weekly_entries.plan_qty.
//
// Auth: admin/manager JWT OR x-cron-secret header matching CRON_SECRET env.
// Body: { date?: "YYYY-MM-DD", shift?: "DAY"|"NIGHT", line?: string, overwrite?: boolean }
// Defaults: current London shift, all lines, only items where target_qty is null/0.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = (Deno.env.get("CRON_SECRET") ?? "").trim();

const SHIFT_MINUTES = 660; // 11h productive window per 12h shift

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

function currentShiftLondon(): { date: string; shift: "DAY" | "NIGHT" } {
  const londonNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/London" }));
  const h = londonNow.getHours();
  if (h >= 6 && h < 18) return { date: londonNow.toISOString().slice(0, 10), shift: "DAY" };
  if (h < 6) {
    const y = new Date(londonNow); y.setDate(y.getDate() - 1);
    return { date: y.toISOString().slice(0, 10), shift: "NIGHT" };
  }
  return { date: londonNow.toISOString().slice(0, 10), shift: "NIGHT" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Auth
  const cronHeader = (req.headers.get("x-cron-secret") ?? "").trim();
  const auth = req.headers.get("authorization") ?? "";
  const cronOk = CRON_SECRET.length > 0 && cronHeader === CRON_SECRET;

  let userOk = false;
  if (!cronOk && auth.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const { data: u } = await userClient.auth.getUser();
    if (u?.user) {
      const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", u.user.id);
      userOk = (roles ?? []).some((r: any) => r.role === "admin" || r.role === "manager");
    }
  }

  if (!cronOk && !userOk) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: any = {};
  try { body = req.method === "POST" ? await req.json() : {}; } catch { /* empty */ }

  const def = currentShiftLondon();
  const date: string = body.date ?? def.date;
  const shift: "DAY" | "NIGHT" = (body.shift ?? def.shift) as any;
  const lineFilter: string | null = body.line ?? null;
  const overwrite: boolean = !!body.overwrite;

  try {
    // 1) Load matching sessions
    let q = admin.from("production_sessions")
      .select("id, line, shift, session_date, locked")
      .eq("session_date", date).eq("shift", shift);
    if (lineFilter) q = q.eq("line", lineFilter);
    const { data: sessions, error: sErr } = await q;
    if (sErr) throw sErr;
    if (!sessions?.length) {
      return new Response(JSON.stringify({ ok: true, updated: 0, message: "no sessions" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sessionIds = sessions.map((s) => s.id);
    const { data: items, error: iErr } = await admin
      .from("production_items")
      .select("id, session_id, sku_id, target_qty, planned_qty")
      .in("session_id", sessionIds);
    if (iErr) throw iErr;

    const skuIds = Array.from(new Set((items ?? []).map((i: any) => i.sku_id)));
    const { data: skus } = await admin
      .from("sku_products").select("id, code, name, target_per_hour").in("id", skuIds);
    const upmById = new Map<string, number>(
      (skus ?? []).map((s: any) => [s.id, Number(s.target_per_hour) || 0]),
    );

    const bySession = new Map<string, typeof items>();
    for (const it of items ?? []) {
      const arr = bySession.get(it.session_id) ?? [];
      arr.push(it); bySession.set(it.session_id, arr);
    }

    const updates: Array<{ id: string; target_qty: number; planned_qty: number }> = [];
    const targetOverrides: Array<{ sku_id: string; line: string; shift: string; target_qty: number }> = [];

    for (const sess of sessions) {
      if (sess.locked) continue;
      const arr = bySession.get(sess.id) ?? [];
      if (!arr.length) continue;
      const minutesPerSku = SHIFT_MINUTES / arr.length;
      for (const it of arr) {
        if (!overwrite && Number(it.target_qty ?? 0) > 0) continue;
        const upm = upmById.get(it.sku_id) ?? 0;
        if (upm <= 0) continue;
        const target = Math.round(upm * minutesPerSku);
        updates.push({ id: it.id, target_qty: target, planned_qty: target });
        targetOverrides.push({ sku_id: it.sku_id, line: sess.line, shift: sess.shift, target_qty: target });
      }
    }

    // 2) Apply item updates
    for (const u of updates) {
      await admin.from("production_items")
        .update({ target_qty: u.target_qty, planned_qty: u.planned_qty })
        .eq("id", u.id);
    }

    // 3) Upsert production_targets baseline (per sku+line+shift)
    if (targetOverrides.length) {
      await admin.from("production_targets")
        .upsert(targetOverrides, { onConflict: "sku_id,line,shift" });
    }

    // 4) Refresh rag_weekly_entries.plan_qty = sum of session targets
    const linesAffected = Array.from(new Set(sessions.map((s) => s.line)));
    for (const ln of linesAffected) {
      const sessIdsForLine = sessions.filter((s) => s.line === ln).map((s) => s.id);
      const itemsForLine = (items ?? []).filter((i: any) => sessIdsForLine.includes(i.session_id));
      const updatedMap = new Map(updates.map((u) => [u.id, u.target_qty]));
      const sumTarget = itemsForLine.reduce(
        (acc: number, i: any) => acc + Number(updatedMap.get(i.id) ?? i.target_qty ?? 0),
        0,
      );
      await admin.from("rag_weekly_entries").upsert(
        { entry_date: date, line: ln, shift, plan_qty: sumTarget },
        { onConflict: "entry_date,line,shift" },
      );
    }

    return new Response(JSON.stringify({
      ok: true, date, shift, sessions: sessions.length, items_updated: updates.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[calculate-shift-targets] error", e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
