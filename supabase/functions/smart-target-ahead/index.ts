// smart-target-ahead — each line's target, saved before the shift starts (Q32–Q40).
//
// pg_cron calls this at :30 and :50 of 04, 05, 16 and 17 UTC (BLOCO 149). Only the runs
// 20–40 and 0–20 minutes before a shift do anything (`aheadShift`), so the same four
// hours cover GMT and BST. Each run:
//   1. reads iTouch's queue for the coming shift, through intouch-list-scheduled-jobs;
//   2. keeps the first read as the shift's queue snapshot (the page reads it later);
//   3. works out each line's performance factor and observed rates from the eight weeks
//      before, exactly as the page does (the code is the same:
//      _shared/smartTarget);
//   4. forecasts each line from the queue and saves it, first save per line wins.
// A line with no jobs is saved as such only on the last run (Q36).
//
// A dry run ({"dry_run": true}) reads and forecasts but saves nothing.
//
// Auth: the cron secret only. Deployed with --no-verify-jwt (supabase/config.toml).
// It writes through save_smart_target_queue/save_smart_target_forecasts as service_role,
// the same first-wins functions the page uses.

import { createClient } from "npm:@supabase/supabase-js@2";
import { aheadShift, forecastAhead } from "../_shared/smartTarget/ahead.ts";
import { queueRowsFromSections, type QueueRow, type ScheduledJobItem } from "../_shared/smartTarget/queue.ts";
import { cleanCycles, lineFactors, type CycleRecord } from "../_shared/smartTarget/rates.ts";
import { FORECAST_LINES, factorWindow, skuFamily, historyFromSessions, type HistoryItem } from "../_shared/smartTarget/history.ts";
import { buildShiftInputs, previousShiftOf, type SmartTargetItem, type SmartTargetSession } from "../_shared/smartTarget/input.ts";
import { buildSkuCatalogue } from "../_shared/production/lineSku.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// The names intouch-poll and calculate-shift-targets accept: one pg_cron secret opens all.
const CRON_SECRETS = ["CRON_SECRET", "CRON_TRIGGER_TOKEN", "CRON_POLL_KEY"]
  .map((k) => (Deno.env.get(k) ?? "").trim())
  .filter((v) => v.length > 0);

const PAGE = 1000;
const IDS_PER_REQUEST = 150;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Page = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;

async function allRows<T>(build: (from: number, to: number) => Page): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return out;
  }
}

/** iTouch's queue for the shift, or why there is none. Never throws. */
async function readQueue(date: string, shift: string, secret: string): Promise<{ rows: QueueRow[] } | { error: string }> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/intouch-list-scheduled-jobs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE}`,
        apikey: SERVICE_ROLE,
        "x-cron-secret": secret,
      },
      body: JSON.stringify({ session_date: date, shift }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) return { error: `intouch-list-scheduled-jobs answered ${res.status}` };
    if (body?.skipped) return { error: body.reason ?? "iTouch did not answer" };
    return { rows: queueRowsFromSections((body?.sections ?? []) as { line: string; items: ScheduledJobItem[] }[]) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

async function factorsFor(date: string) {
  const cycleRows = await allRows<{ machine: string; sku: string; cycle_seconds: number | null; cavities: number | null; source: string }>(
    (a, b) => admin.from("itouch_cycle_times").select("machine, sku, cycle_seconds, cavities, source").order("id").range(a, b),
  );
  const records: CycleRecord[] = cycleRows.map((r) => ({
    line: r.machine,
    sku: r.sku,
    cycleSeconds: r.cycle_seconds === null ? null : Number(r.cycle_seconds),
    cavities: r.cavities === null ? null : Number(r.cavities),
    source: r.source,
  }));
  const { cycles } = cleanCycles(records);

  const { from, to } = factorWindow(date);
  const sessions = await allRows<SmartTargetSession>(
    (a, b) => admin.from("production_sessions").select("id, line, session_date, shift, started_at")
      .gte("session_date", from).lte("session_date", to).order("id").range(a, b),
  );
  const ids = sessions.map((s) => s.id);
  const items: HistoryItem[] = [];
  for (let i = 0; i < ids.length; i += IDS_PER_REQUEST) {
    items.push(...await allRows<HistoryItem>(
      (a, b) => admin.from("production_items").select("session_id, display_order, sku_id, sku_code_text, actual_qty")
        .in("session_id", ids.slice(i, i + IDS_PER_REQUEST)).order("id").range(a, b),
    ));
  }
  const skus = await allRows<{ id: string; code: string; name: string; target_per_hour: number | null }>(
    (a, b) => admin.from("sku_products").select("id, code, name, target_per_hour").order("code").range(a, b),
  );
  const catalogue = buildSkuCatalogue(skus);
  const history = historyFromSessions(sessions, items, catalogue);
  return { cycles, history, catalogue, factors: cycles.length ? lineFactors(history, cycles) : [] };
}

/** What each line last logged on the shift before, the same way the page reads it (Q17). */
async function previousSkusFor(date: string, shift: "DAY" | "NIGHT", catalogue: ReturnType<typeof buildSkuCatalogue>) {
  const prev = previousShiftOf(date, shift);
  const sessions = await allRows<SmartTargetSession>(
    (a, b) => admin.from("production_sessions").select("id, line, session_date, shift, started_at")
      .eq("session_date", prev.date).eq("shift", prev.shift).order("id").range(a, b),
  );
  const items = sessions.length
    ? await allRows<SmartTargetItem>(
      (a, b) => admin.from("production_items").select("id, session_id, display_order, sku_id, sku_code_text, planned_qty, created_at")
        .in("session_id", sessions.map((s) => s.id)).order("id").range(a, b),
    )
    : [];
  const { lines } = buildShiftInputs(date, shift, sessions, items, catalogue);
  return Object.fromEntries(lines.map((l) => [l.line, l.input.previousSku ?? undefined]));
}

Deno.serve(async (req) => {
  const presented = (req.headers.get("x-cron-secret") ?? "").trim();
  if (!CRON_SECRETS.length) return json({ ok: false, error: "server_misconfigured" }, 503);
  if (!presented || !CRON_SECRETS.includes(presented)) return json({ ok: false, error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const dryRun = body?.dry_run === true;
  // A dry run may pretend to be another moment ({"dry_run": true, "at": "…Z"}), to see what
  // a run before a shift would save. Only a dry run: it saves nothing.
  const at = dryRun && typeof body?.at === "string" ? new Date(body.at) : new Date();
  if (Number.isNaN(at.getTime())) return json({ ok: false, error: "at is not a date" }, 400);
  const ahead = aheadShift(at);
  if (!ahead) return json({ ok: true, skipped: "No shift starts in the next 40 minutes." });
  const { date, shift, minutesToStart, final } = ahead;

  try {
    const { data: saved, error: savedErr } = await admin
      .from("smart_target_forecasts").select("line, expected_total").eq("session_date", date).eq("shift", shift);
    if (savedErr) throw new Error(savedErr.message);
    // A line saved without a number can still get one (Q57a).
    const rowsSaved = (saved ?? []) as { line: number; expected_total: number | null }[];
    const done = new Set(rowsSaved.filter((r) => r.expected_total !== null).map((r) => r.line));
    const saidNothing = new Set(rowsSaved.filter((r) => r.expected_total === null).map((r) => r.line));
    if (done.size >= 6) return json({ ok: true, date, shift, skipped: "Every line already has its forecast." });

    const queue = await readQueue(date, shift, presented);
    if ("error" in queue) {
      // Never save "no jobs" when iTouch did not answer: that would blame the import.
      return json({ ok: false, date, shift, final, error: `iTouch queue not read: ${queue.error}` }, 502);
    }
    if (!dryRun && queue.rows.length) {
      const { error } = await admin.rpc("save_smart_target_queue", { p_date: date, p_shift: shift, p_rows: queue.rows });
      if (error) throw new Error(`Queue not saved: ${error.message}`);
    }

    const { cycles, factors, history, catalogue } = await factorsFor(date);
    const previousSkus = await previousSkusFor(date, shift, catalogue);
    const { rows } = forecastAhead({ date, shift, minutesToStart, final, queue: queue.rows, cycles, factors, history, shownLines: FORECAST_LINES, previousSkus, familyOf: skuFamily(catalogue) });
    const toSave = rows
      .filter((r) => !done.has(r.line) && (r.expected_total !== null || !saidNothing.has(r.line)))
      .map((r) => ({ ...r, source: "ahead", queue_read_at: new Date().toISOString() }));

    if (dryRun) return json({ ok: true, dry_run: true, date, shift, minutesToStart, final, rows: toSave });
    let savedCount = 0;
    if (toSave.length) {
      const { data, error } = await admin.rpc("save_smart_target_forecasts", { p_date: date, p_shift: shift, p_rows: toSave });
      if (error) throw new Error(`Forecasts not saved: ${error.message}`);
      savedCount = (data as { saved?: number } | null)?.saved ?? 0;
    }
    return json({
      ok: true, date, shift, minutesToStart, final,
      queued: queue.rows.length, saved: savedCount,
      lines: toSave.map((r) => ({ line: r.line, status: r.status, expected_total: r.expected_total })),
    });
  } catch (e) {
    console.error("[smart-target-ahead]", e);
    return json({ ok: false, date, shift, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
