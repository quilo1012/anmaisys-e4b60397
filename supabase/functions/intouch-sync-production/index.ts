// Pulls production for a given session_date + shift directly from the
// iTouching API and upserts a `production_sessions` row + `production_items`
// rows per line (auto-creating sku_products as needed).
//
// Endpoints used (discovered via /swagger/docs/v1):
//   POST /api/GetJobsRanDuringPeriod?StartTime&EndTime  body: [MachineGUID,...]
//     -> Jobs[].WorksOrders[].PartCode / LongDescription / OrderQuantity / StartTime / EndTime
//   GET  /api/GetMachineCycles?MachineGUID&StartTime&EndTime
//     -> total good cycles produced by that machine in the window
//
// One line may have multiple iTouching machines mapped. We aggregate by line:
//   - planned_qty per SKU = sum(WorksOrder.OrderQuantity) across machines/jobs
//   - actual_qty  per SKU = cycles distributed proportionally to each job's
//                            time slice inside the shift window
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTOUCH_URL = (Deno.env.get("INTOUCH_API_URL") ?? "").replace(/\/+$/, "");
const INTOUCH_TOKEN = Deno.env.get("INTOUCH_API_TOKEN") ?? "";

async function it(path: string, init?: RequestInit) {
  const res = await fetch(`${INTOUCH_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${INTOUCH_TOKEN}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`iTouching ${path} ${res.status}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { return text; }
}

// London BST shift windows: DAY 06:00→18:00, NIGHT 18:00→06:00(+1) local.
// Server time is UTC; convert with the offset for the supplied date.
// Simple approach: build local string and let JS parse with explicit +01:00
// (BST). This matches the cron schedules already in use for closing shifts.
function shiftWindow(date: string, shift: "DAY" | "NIGHT") {
  const startLocal = shift === "DAY" ? `${date}T06:00:00+01:00` : `${date}T18:00:00+01:00`;
  const start = new Date(startLocal);
  const end = new Date(start.getTime() + 12 * 3600 * 1000);
  return { start, end };
}

function londonDateString(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function currentLondonShift() {
  const now = new Date();
  const londonHour = Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    hour12: false,
  }).format(now));

  if (londonHour >= 6 && londonHour < 18) {
    return { session_date: londonDateString(now), shift: "DAY" as const };
  }

  if (londonHour >= 18) {
    return { session_date: londonDateString(now), shift: "NIGHT" as const };
  }

  const previousLondonDay = new Date(now);
  previousLondonDay.setUTCDate(previousLondonDay.getUTCDate() - 1);
  return { session_date: londonDateString(previousLondonDay), shift: "NIGHT" as const };
}

function overlapMs(a1: Date, a2: Date, b1: Date, b2: Date) {
  return Math.max(0, Math.min(a2.getTime(), b2.getTime()) - Math.max(a1.getTime(), b1.getTime()));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!INTOUCH_URL || !INTOUCH_TOKEN) throw new Error("Missing INTOUCH_API_URL/TOKEN");

    const CRON_SECRET = Deno.env.get("CRON_TRIGGER_TOKEN") ?? Deno.env.get("CRON_SECRET") ?? "";
    const providedCron = req.headers.get("x-cron-secret") ?? "";
    const isCron = !!CRON_SECRET && providedCron === CRON_SECRET;


    const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

    // Master switch: when disabled, skip all sync (cron + manual).
    const { data: settings } = await admin
      .from("system_settings")
      .select("intouch_sync_enabled")
      .limit(1)
      .maybeSingle();
    if (settings && settings.intouch_sync_enabled === false) {
      return new Response(
        JSON.stringify({ success: false, skipped: true, reason: "intouch_sync_disabled" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!isCron) {
      // Auth: admin or manager only (validate JWT via getClaims — works with signing keys)
      const authHeader = req.headers.get("Authorization") ?? "";
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (!token) {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const anonClient = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
      const { data: claimsData, error: claimsErr } = await anonClient.auth.getClaims(token);
      const userId = claimsData?.claims?.sub as string | undefined;
      if (claimsErr || !userId) {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", userId);
      const ok = (roles ?? []).some((r) => ["admin", "manager"].includes(r.role));
      if (!ok) {
        return new Response(JSON.stringify({ error: "forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const body = await req.json().catch(() => ({}));
    // Cron auto-derives: morning closes previous NIGHT (yesterday's date in London),
    // evening closes today's DAY shift. Manual `force:true` sync derives the
    // currently active London shift so the Settings button works without inputs.
    let session_date: string = body.session_date;
    let shift: "DAY" | "NIGHT" = body.shift;
    if (isCron && (!session_date || !shift)) {
      const auto = body.auto as "morning" | "evening" | undefined;
      const londonNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/London" }));
      if (auto === "morning") {
        const y = new Date(londonNow); y.setDate(y.getDate() - 1);
        session_date = y.toISOString().slice(0, 10);
        shift = "NIGHT";
      } else {
        session_date = londonNow.toISOString().slice(0, 10);
        shift = "DAY";
      }
    }
    if (!isCron && body.force === true && (!session_date || !shift)) {
      const current = currentLondonShift();
      session_date = current.session_date;
      shift = current.shift;
    }
    if (!session_date || !["DAY", "NIGHT"].includes(shift)) {
      return new Response(JSON.stringify({ error: "session_date and shift (DAY|NIGHT) required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


    const { start, end } = shiftWindow(session_date, shift);
    const startISO = start.toISOString();
    const endISO = end.toISOString();

    // Group mapped machines by line
    const { data: maps } = await admin
      .from("intouch_machine_map")
      .select("intouch_machine_id, intouch_machine_name, line_id")
      .eq("active", true)
      .not("line_id", "is", null);

    const { data: lines } = await admin.from("lines").select("id, name");
    const lineName = new Map((lines ?? []).map((l: any) => [l.id, l.name]));

    const byLine = new Map<string, Array<{ id: string; name: string }>>();
    for (const m of maps ?? []) {
      const arr = byLine.get(m.line_id!) ?? [];
      arr.push({ id: m.intouch_machine_id, name: m.intouch_machine_name ?? "" });
      byLine.set(m.line_id!, arr);
    }

    const results: any[] = [];
    for (const [line_id, machines] of byLine) {
      const line = lineName.get(line_id);
      if (!line) continue;

      // Aggregate per SKU (PartCode) — only identify which SKUs ran on this line
      // and how long each one ran in the shift window (for proportional plan split).
      type Agg = { ms: number; description: string };
      const skuAgg = new Map<string, Agg>();

      for (const m of machines) {
        const resp = await it(
          `/api/GetJobsRanDuringPeriod?StartTime=${startISO}&EndTime=${endISO}`,
          { method: "POST", body: JSON.stringify([m.id]) },
        );
        const jobs: any[] = resp?.Jobs ?? [];

        for (const j of jobs) {
          const js = new Date(j.StartTime);
          const je = j.EndTime && !j.EndTime.startsWith("0001") ? new Date(j.EndTime) : end;
          const ms = overlapMs(js, je, start, end);
          if (ms <= 0) continue;
          const wo = (j.WorksOrders ?? [])[0];
          const code = (wo?.PartCode || wo?.OrderNumber || "UNKNOWN").trim();
          const desc = (wo?.LongDescription || wo?.Description || code).trim();
          const cur = skuAgg.get(code) ?? { ms: 0, description: desc };
          cur.ms += ms;
          cur.description = cur.description || desc;
          skuAgg.set(code, cur);
        }
      }

      if (skuAgg.size === 0) {
        results.push({ line, skipped: "no jobs ran" });
        continue;
      }

      // Ensure sku_products rows exist; collect ids
      const codes = Array.from(skuAgg.keys());
      const { data: existingSkus } = await admin
        .from("sku_products").select("id, code").in("code", codes);
      const have = new Set((existingSkus ?? []).map((s: any) => s.code));
      const toInsert = codes
        .filter((c) => !have.has(c))
        .map((c) => ({ code: c, name: skuAgg.get(c)!.description.slice(0, 200), active: true }));
      if (toInsert.length) {
        await admin.from("sku_products")
          .upsert(toInsert, { onConflict: "code", ignoreDuplicates: true });
      }
      const { data: allSkus } = await admin
        .from("sku_products").select("id, code").in("code", codes);
      const idByCode = new Map((allSkus ?? []).map((s: any) => [s.code, s.id]));

      // Upsert session
      const { data: session, error: sErr } = await admin
        .from("production_sessions")
        .upsert(
          { session_date, line, shift, notes: "[Auto-synced from iTouching — SKUs only]" },
          { onConflict: "session_date,line,shift" },
        )
        .select("id, locked").single();
      if (sErr) throw sErr;
      if (session.locked) {
        results.push({ line, skipped: "session locked" });
        continue;
      }

      // Plan comes from RAG Weekly — distribute across SKUs proportionally
      // to their run-time on the line. Leader enters actual_qty on the tablet.
      const { data: rag } = await admin
        .from("rag_weekly_entries")
        .select("plan_qty")
        .eq("entry_date", session_date)
        .eq("line", line)
        .eq("shift", shift)
        .maybeSingle();
      const ragPlan = Number(rag?.plan_qty ?? 0);

      // Preserve any actuals already typed by the leader
      const { data: existingItems } = await admin
        .from("production_items")
        .select("sku_id, actual_qty")
        .eq("session_id", session.id);
      const actualBySku = new Map(
        (existingItems ?? []).map((r: any) => [r.sku_id, Number(r.actual_qty) || 0]),
      );

      await admin.from("production_items").delete().eq("session_id", session.id);

      const entries = Array.from(skuAgg.entries());
      const totalMs = entries.reduce((s, [, a]) => s + a.ms, 0) || 1;
      const rows = entries
        .map(([code, a], _i, arr) => {
          const plan = ragPlan > 0
            ? Math.round(ragPlan * (a.ms / totalMs))
            : 0;
          const sku_id = idByCode.get(code);
          return {
            session_id: session.id,
            sku_id,
            target_qty: plan,
            planned_qty: plan,
            actual_qty: sku_id ? (actualBySku.get(sku_id) ?? 0) : 0,
            notes: null,
          };
        })
        .filter((r) => r.sku_id);
      if (rows.length) await admin.from("production_items").insert(rows);

      results.push({
        line,
        skus: rows.length,
        rag_plan: ragPlan,
        actual_preserved: rows.reduce((s, r) => s + r.actual_qty, 0),
      });
    }
    const syncedLines = results.filter((r) => !r.skipped).length;
    const syncedSkus = results.reduce((sum, r) => sum + Number(r.skus ?? 0), 0);

    return new Response(JSON.stringify({ ok: true, session_date, shift,
      summary: `${syncedLines} lines · ${syncedSkus} SKUs`,
      window: { start: startISO, end: endISO }, results }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
