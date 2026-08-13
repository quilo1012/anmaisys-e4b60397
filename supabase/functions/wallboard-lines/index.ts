// Read-only feed for the production wallboard hanging on the TV.
//
// The board cannot read the tables directly. `intouch_machine_map` grants SELECT
// only to `authenticated`, and its policy narrows that further to admin/manager/
// maintenance_manager/engineer; `lines`, `production_sessions`, `production_items`
// and `sku_products` are `TO authenticated` too. A TV holding the anon key gets
// zero rows and a blank board — no error, no clue why.
//
// It must not call iTouching either. The API token is a server secret, iTouching
// sends no CORS headers, and the daily egress quota is shared with intouch-poll:
// one TV polling every 5s is ~17k calls/day, which would block the poll that opens
// work orders until midnight UTC.
//
// So the board asks this function, this function reads the database with the
// service role, and returns only the ten fields a tile draws.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WALLBOARD_KEY = (Deno.env.get("WALLBOARD_KEY") ?? "").trim();

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

// A TV browser cannot set request headers on a plain page load, so the key comes
// in the query string. That is a bearer token in a URL: fine for a read-only board
// on the factory network, never acceptable for anything that writes. It must NOT
// be a Supabase key — those carry far more authority than this endpoint.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-wallboard-key",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "no-store",
};

// iTouching status codes, and 4 is the one this factory actually sends while it
// is filling bottles. It was missing here, so every line running normally — no
// stop code, status 4 — fell through to `state = null` and the TV showed SEM
// SINAL on a line making product. Six of seven tiles read that way on 13/08.
//
// The pair that settled it, both screens at the same minute: 13/08 07:33 UTC,
// Filler Lines 2, 3 and 6 and the Tablet Line at status 4 with no code, all four
// GREEN and "Running" on the iTouching board. Second reading, 12/08 21:38 UTC:
// Filler Line 1 at 4, no code, running at 12,1 fills a minute.
//
// 8 is the same machine running faster: the Tablet Line, green and "Running" on
// OMEGA 3 at 16,4 fills a minute against a 14,3 standard, back at 4 minutes
// later on the same job. The number moves with the pace; both are production.
//
// 1 and 2 stay because they were always here and nothing has contradicted them —
// no machine in this installation has ever reported either. 5, 6 and 7 are
// deliberately out: 7 has never been seen without a code (the branch above
// answers it first), and 6 has two sightings that point opposite ways. An
// untranslated number keeps returning null, which is this board saying it cannot
// tell — not a green light nobody earned. Same table, same evidence, as
// `src/lib/lineLiveStatus.ts`; the two must be changed together.
const HEALTHY_STATUS = new Set<number>([1, 2, 4, 8]);

// SETUP and IDLE do not exist in the iTouching contract. The only way to reach
// them is by naming the stop codes that mean each one, and that is an admin's
// decision, not a guess. Until these lists are filled, any stop is STOP — which
// is honest, if blunt.
//
// Match is case-insensitive against intouch_stop_code_map.label.
const SETUP_LABELS: string[] = [];
const IDLE_LABELS: string[] = [];

// Collapses a burst of TVs onto one set of queries. The poll writes at most once
// a minute, so four seconds of staleness costs nothing and six screens refreshing
// together stop being six round trips to Postgres.
let cache: { at: number; body: string } | null = null;
const CACHE_MS = 4000;

function currentShiftLondon(): { date: string; shift: "DAY" | "NIGHT" } {
  const londonNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/London" }));
  const h = londonNow.getHours();
  if (h >= 6 && h < 18) return { date: londonNow.toISOString().slice(0, 10), shift: "DAY" };
  if (h < 6) {
    const y = new Date(londonNow);
    y.setDate(y.getDate() - 1);
    return { date: y.toISOString().slice(0, 10), shift: "NIGHT" };
  }
  return { date: londonNow.toISOString().slice(0, 10), shift: "NIGHT" };
}

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();
const minutesSince = (iso: string | null, now: number) =>
  iso ? Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000)) : null;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const json = (body: unknown, status = 200) =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  // An empty secret never opens the door. Same rule as intouch-poll: no silent
  // open mode, because this endpoint would then publish the whole shift's output.
  if (!WALLBOARD_KEY) {
    console.error("[wallboard-lines] WALLBOARD_KEY is not configured; refusing all requests.");
    return json({ ok: false, error: "server_misconfigured" }, 503);
  }
  const url = new URL(req.url);
  const presented = (url.searchParams.get("k") ?? req.headers.get("x-wallboard-key") ?? "").trim();
  if (!presented || presented !== WALLBOARD_KEY) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) return json(cache.body);

  try {
    const { date: session_date, shift } = currentShiftLondon();

    const [linesQ, mapQ, codesQ, sessionsQ] = await Promise.all([
      admin.from("lines").select("id, name, display_order")
        .eq("active", true).eq("is_warehouse", false)
        .order("display_order", { ascending: true }),
      admin.from("intouch_machine_map")
        .select("line_id, intouch_machine_name, last_status, last_downtime_code, last_seen_at, prod_dt_started_at")
        .eq("active", true),
      admin.from("intouch_stop_code_map").select("stop_code, label, category"),
      admin.from("production_sessions").select("id, line")
        .eq("session_date", session_date).eq("shift", shift),
    ]);

    const lines = linesQ.data ?? [];
    if (!lines.length) return json({ ok: true, generated_at: new Date().toISOString(), lines: [] });

    const sessionIds = (sessionsQ.data ?? []).map((s: any) => s.id);
    const itemsQ = sessionIds.length
      ? await admin.from("production_items")
          .select("session_id, sku_code_text, batch_code, actual_qty, intouch_qty, planned_qty, started_at, finished_at, display_order")
          .in("session_id", sessionIds)
          .order("display_order", { ascending: true })
      : { data: [] as any[] };

    const skuCodes = Array.from(
      new Set((itemsQ.data ?? []).map((i: any) => i.sku_code_text).filter(Boolean)),
    ) as string[];
    const skusQ = skuCodes.length
      ? await admin.from("sku_products").select("code, target_per_hour").in("code", skuCodes)
      : { data: [] as any[] };

    const rateByCode = new Map<string, number>(
      (skusQ.data ?? []).map((s: any) => [norm(s.code), Number(s.target_per_hour) || 0]),
    );
    const codeLabel = new Map<string, string>(
      (codesQ.data ?? []).map((c: any) => [norm(c.stop_code), String(c.label ?? "")]),
    );
    // Session id → line name, so items can be found by the line they belong to.
    const sessionLine = new Map<string, string>(
      (sessionsQ.data ?? []).map((s: any) => [s.id, norm(s.line)]),
    );
    const itemsByLine = new Map<string, any[]>();
    for (const it of itemsQ.data ?? []) {
      const key = sessionLine.get(it.session_id);
      if (!key) continue;
      const arr = itemsByLine.get(key) ?? [];
      arr.push(it);
      itemsByLine.set(key, arr);
    }
    const machineByLine = new Map<string, any>();
    for (const m of mapQ.data ?? []) {
      // A line can carry several mapped machines. The one that decides the tile is
      // the one that is stopped — a line is not running because four of its five
      // machines are.
      const prev = machineByLine.get(m.line_id);
      if (!prev || (m.last_downtime_code && !prev.last_downtime_code)) {
        machineByLine.set(m.line_id, m);
      }
    }

    const out = lines.map((l: any) => {
      const m = machineByLine.get(l.id) ?? null;
      const items = itemsByLine.get(norm(l.name)) ?? [];
      // The order on the tile is the one being made: started and not finished.
      // Falling back to the first unfinished row keeps the tile populated between
      // an operator finishing one SKU and starting the next.
      const cur = items.find((i) => i.started_at && !i.finished_at)
        ?? items.find((i) => !i.finished_at)
        ?? null;

      const status = m && m.last_status != null ? Number(m.last_status) : null;
      const codeKey = norm(m?.last_downtime_code);
      const reason = codeKey ? (codeLabel.get(codeKey) || null) : null;

      let state: "RUN" | "STOP" | "SETUP" | "IDLE" | null;
      if (!m || status == null) {
        // No mapped machine, or never polled. Reported as unknown so the tile can
        // show SEM SINAL instead of a green light nobody earned.
        state = null;
      } else if (codeKey) {
        const lbl = norm(reason);
        state = SETUP_LABELS.some((x) => norm(x) === lbl) ? "SETUP"
          : IDLE_LABELS.some((x) => norm(x) === lbl) ? "IDLE"
          : "STOP";
      } else {
        state = HEALTHY_STATUS.has(status) ? "RUN" : null;
      }

      const made = cur ? Number(cur.intouch_qty ?? cur.actual_qty ?? 0) : null;

      return {
        n: l.name,
        sku: cur?.sku_code_text ?? null,
        // production_items has no iTouching order number. batch_code is the closest
        // local identifier; it is NOT the OrderNumber the iTouching screens show.
        ord: cur?.batch_code ?? null,
        rate: cur?.sku_code_text ? (rateByCode.get(norm(cur.sku_code_text)) || null) : null,
        made,
        // Typed by the operator, not counted by a machine. It jumps between entries
        // instead of climbing, and the tile should not be read as a live counter.
        made_source: cur ? (cur.intouch_qty != null ? "intouch" : "manual") : null,
        elapsed: minutesSince(cur?.started_at ?? null, now),
        state,
        raw_status: status,
        // Age is settled here and the board adds its own elapsed time on top. A TV
        // whose clock is months out would otherwise put every tile in SEM SINAL, or
        // worse, keep a dead one green.
        age: m?.last_seen_at ? Math.max(0, Math.round((now - new Date(m.last_seen_at).getTime()) / 1000)) : null,
        reason,
        rmin: minutesSince(m?.prod_dt_started_at ?? null, now),
        machine: m?.intouch_machine_name ?? null,
      };
    });

    const body = JSON.stringify({
      ok: true,
      generated_at: new Date().toISOString(),
      session_date,
      shift,
      lines: out,
    });
    cache = { at: now, body };
    return json(body);
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    console.error("[wallboard-lines] fatal:", msg);
    // 503 and no `lines` key on purpose. A 200 with an empty list would tell the
    // board every line went quiet, and it would blank six tiles over a failed query.
    return json({ ok: false, error: msg }, 503);
  }
});
