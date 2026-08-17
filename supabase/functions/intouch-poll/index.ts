// Polls the iTouching API for the live status of mapped machines and opens
// a maintenance Work Order when a machine enters a downtime state. Designed
// to be called every 1-2 minutes by pg_cron.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { readStop, HEALTHY_STATUS } from "./stopReading.ts";
import { pickRunningJob } from "./liveJob.ts";
import { checkMachineLine } from "./mappingIntegrity.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTOUCH_URL = (Deno.env.get("INTOUCH_API_URL") ?? "").replace(/\/+$/, "");
const INTOUCH_TOKEN = Deno.env.get("INTOUCH_API_TOKEN") ?? "";
const INTOUCH_AUTH_HEADER = /^bearer\s+/i.test(INTOUCH_TOKEN.trim())
  ? INTOUCH_TOKEN.trim()
  : `Bearer ${INTOUCH_TOKEN.trim()}`;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

// `HEALTHY_STATUS` is imported from `stopReading.ts`, where the rule it belongs
// to now lives. Here it means one thing only: the baseline for opening a work
// order. A new WO needs a confirmed transition — a poll that saw the machine
// running with no code, then saw it stopped — so a stale code on a machine
// being mapped or re-enabled cannot raise one on its own.

// ── iTouching quota / timeout helpers ──────────────────────────────────────
const ITOUCH_TIMEOUT_MS = 10_000;
const tomorrowUtcMidnight = () => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
};
async function intouchQuotaBlockedUntil(): Promise<string | null> {
  try {
    const { data } = await admin
      .from("intouch_quota_status").select("blocked_until")
      .eq("id", "singleton").maybeSingle();
    if (data?.blocked_until && new Date(data.blocked_until).getTime() > Date.now()) {
      return data.blocked_until as string;
    }
  } catch { /* best-effort */ }
  return null;
}
async function intouchMarkEgressExceeded() {
  try {
    await admin.from("intouch_quota_status").upsert({
      id: "singleton",
      blocked_until: tomorrowUtcMidnight(),
      updated_at: new Date().toISOString(),
    });
  } catch { /* best-effort */ }
}
class ItouchQuotaError extends Error {
  blocked_until: string;
  constructor(until: string) { super("iTouching daily quota exhausted"); this.blocked_until = until; }
}
class ItouchTimeoutError extends Error {
  constructor() { super("iTouching API timeout"); }
}

async function it(path: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ITOUCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${INTOUCH_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: INTOUCH_AUTH_HEADER,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch (e) {
    if ((e as any)?.name === "AbortError") throw new ItouchTimeoutError();
    throw e;
  } finally {
    clearTimeout(timeout);
  }
  const text = await res.text();
  if (text.includes("Exceeded API Max daily egress")) {
    await intouchMarkEgressExceeded();
    throw new ItouchQuotaError(tomorrowUtcMidnight());
  }
  if (!res.ok) throw new Error(`iTouching ${path} ${res.status}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { return text; }
}

function normalizeStopCode(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function parseStatus(value: unknown) {
  const status = Number(value);
  return Number.isFinite(status) ? status : null;
}

function currentShiftLondon(): { date: string; shift: "DAY" | "NIGHT" } {
  const londonNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/London" }));
  const h = londonNow.getHours();
  if (h >= 6 && h < 18) {
    return { date: londonNow.toISOString().slice(0, 10), shift: "DAY" };
  }
  // Night shift: 18:00 → 06:00. Before 06:00 belongs to previous day's NIGHT.
  if (h < 6) {
    const y = new Date(londonNow); y.setDate(y.getDate() - 1);
    return { date: y.toISOString().slice(0, 10), shift: "NIGHT" };
  }
  return { date: londonNow.toISOString().slice(0, 10), shift: "NIGHT" };
}

async function syncRunningSkus(
  mapped: Array<{ intouch_machine_id: string; intouch_machine_name: string | null; line_id: string | null }>,
) {
  const { date: session_date, shift } = currentShiftLondon();
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 60 * 1000); // last 30min window

  // group machines by line
  const byLine = new Map<string, string[]>();
  for (const m of mapped) {
    if (!m.line_id) continue;
    const arr = byLine.get(m.line_id) ?? [];
    arr.push(m.intouch_machine_id);
    byLine.set(m.line_id, arr);
  }
  if (byLine.size === 0) return;

  const { data: lines } = await admin.from("lines").select("id, name");
  const lineName = new Map((lines ?? []).map((l: any) => [l.id, l.name]));

  for (const [line_id, machineIds] of byLine) {
    const lineLbl = lineName.get(line_id);
    if (!lineLbl) continue;

    let resp: any;
    try {
      resp = await it(
        `/api/GetJobsRanDuringPeriod?StartTime=${start.toISOString()}&EndTime=${end.toISOString()}`,
        { method: "POST", body: JSON.stringify(machineIds) },
      );
    } catch {
      continue;
    }
    const jobs: any[] = resp?.Jobs ?? [];
    // Most recent SKU codes seen on the line
    const seen = new Map<string, string>(); // code -> description
    for (const j of jobs) {
      const wo = (j.WorksOrders ?? [])[0];
      const code = String(wo?.PartCode || wo?.OrderNumber || "").trim();
      if (!code) continue;
      const desc = String(wo?.LongDescription || wo?.Description || code).trim();
      if (!seen.has(code)) seen.set(code, desc);
    }
    if (seen.size === 0) continue;

    // Ensure sku_products rows
    const codes = Array.from(seen.keys());
    const { data: existSkus } = await admin
      .from("sku_products").select("id, code").in("code", codes);
    const have = new Set((existSkus ?? []).map((s: any) => s.code));
    const toInsert = codes
      .filter((c) => !have.has(c))
      .map((c) => ({ code: c, name: (seen.get(c) || c).slice(0, 200), active: true }));
    if (toInsert.length) {
      await admin.from("sku_products")
        .upsert(toInsert, { onConflict: "code", ignoreDuplicates: true });
    }
    const { data: allSkus } = await admin
      .from("sku_products").select("id, code").in("code", codes);
    const idByCode = new Map((allSkus ?? []).map((s: any) => [s.code, s.id as string]));

    // Ensure production_session for today's current shift
    const { data: session } = await admin
      .from("production_sessions")
      .upsert(
        { session_date, line: lineLbl, shift, notes: "[Auto-synced from iTouching — SKUs only]" },
        { onConflict: "session_date,line,shift" },
      )
      .select("id, locked").single();
    if (!session || session.locked) continue;

    // NOTE: intentionally do NOT insert stubs into production_items here.
    // GetJobsRanDuringPeriod returns Running/recently-run jobs, not Scheduled,
    // so inserting them would leak wrong SKUs into the operator's schedule
    // (same anti-pattern documented in intouch-list-scheduled-jobs).
  }
}

async function notifyEngineersNewWO(opts: {
  woId: string;
  woNumber: number;
  machine: string | null;
  line: string | null;
  description: string;
  priority: string;
}) {
  try {
    const { data: engRoles } = await admin
      .from("user_roles").select("user_id").eq("role", "engineer");
    const userIds = (engRoles ?? []).map((r: any) => r.user_id);
    if (!userIds.length) return;
    const title = `🚨 New WO #${opts.woNumber} — ${opts.machine ?? opts.line ?? "Line"}`;
    const body = `${opts.description}${opts.line ? `\nLine: ${opts.line}` : ""}\nAuto-created from iTouching`;
    await admin.from("notifications").insert(
      userIds.map((uid: string) => ({
        user_id: uid,
        wo_id: opts.woId,
        title,
        body,
        priority: opts.priority === "critical" ? "high" : opts.priority,
        action_url: `/dashboard/wo/${opts.woId}`,
      })),
    );
  } catch (_) { /* best-effort */ }
}





Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Auth: this function is only callable by the pg_cron job or an admin.
  // pg_cron sends the CRON_SECRET via the x-cron-secret header (or as a Bearer
  // token). Reject anything else.
  //
  // Hardening rules:
  //   - Both env secrets must be NON-EMPTY strings. An empty/missing secret
  //     must NEVER allow a request through (no silent open mode).
  //   - Header comparison uses constant-time-equivalent strict equality on
  //     trimmed values. A blank/empty incoming header is always rejected.
  //   - On any rejection we emit a structured warn log (without ever logging
  //     the secret value) so missing/invalid attempts are observable.
  const cronSecret = (Deno.env.get("CRON_SECRET") ?? "").trim();
  const cronTriggerToken = (Deno.env.get("CRON_TRIGGER_TOKEN") ?? "").trim();
  const cronPollKey = (Deno.env.get("CRON_POLL_KEY") ?? "").trim();

  if (!cronSecret && !cronTriggerToken && !cronPollKey) {
    console.error("[intouch-poll][auth] CRON_SECRET/CRON_TRIGGER_TOKEN/CRON_POLL_KEY are not configured; refusing all requests.");
    return new Response(JSON.stringify({ ok: false, error: "server_misconfigured" }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const providedHeader = (req.headers.get("x-cron-secret") ?? "").trim();
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const presented = providedHeader || bearer;

  const matches = (expected: string) =>
    expected.length > 0 && presented.length > 0 && presented === expected;

  let allowed = matches(cronSecret) || matches(cronTriggerToken) || matches(cronPollKey);


  // Also allow an authenticated admin/manager (e.g. Sync Now from the UI).
  let authDebug: Record<string, unknown> = {};
  if (!allowed && bearer) {
    try {
      let userId: string | null = null;
      const { data: claimsData, error: claimsErr } = await admin.auth.getClaims(bearer);
      if (!claimsErr && claimsData?.claims?.sub) {
        userId = claimsData.claims.sub as string;
      } else {
        const { data: userData, error: userErr } = await admin.auth.getUser(bearer);
        if (!userErr && userData?.user?.id) userId = userData.user.id;
        authDebug.getUserErr = userErr?.message ?? null;
        authDebug.getClaimsErr = claimsErr?.message ?? null;
      }
      if (userId) {
        const { data: roles, error: rolesErr } = await admin
          .from("user_roles")
          .select("role")
          .eq("user_id", userId);
        authDebug.userId = userId;
        authDebug.roles = (roles ?? []).map((r: any) => r.role);
        authDebug.rolesErr = rolesErr?.message ?? null;
        if ((roles ?? []).some((r: any) => r.role === "admin" || r.role === "manager")) {
          allowed = true;
        }
      }
    } catch (e: any) {
      authDebug.exception = e?.message ?? String(e);
    }
  }

  if (!allowed) {
    console.warn("[intouch-poll][auth] unauthorized call", {
      hasXCronSecretHeader: providedHeader.length > 0,
      hasBearer: bearer.length > 0,
      bearerLen: bearer.length,
      ua: req.headers.get("user-agent") ?? null,
      from: req.headers.get("x-forwarded-for") ?? null,
      authDebug,
    });
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ⏸️ Toggle controlled by Settings → iTouching (system_settings.intouch_auto_wo_enabled).
  //
  // It governs whether an order is OPENED, and nothing else. The comment above this
  // block always said that; the code returned early instead, so with the toggle off
  // the poll answered `{"paused": true, "polled": 0}` every minute and never read a
  // machine at all.
  //
  // That is how the mapping page came to show six machines stopped on a status last
  // written at 15:49 on 04/08 — two days of red badges with no date beside them,
  // while the cron fired sixty times an hour and did nothing. Reading is not an
  // automatic action; opening somebody a work order is.
  let autoWoEnabled = true;
  try {
    const { data: ss } = await admin
      .from("system_settings")
      .select("intouch_auto_wo_enabled")
      .limit(1)
      .maybeSingle();
    autoWoEnabled = !!ss?.intouch_auto_wo_enabled;
  } catch (_e) { /* run normally if the flag cannot be read */ }


  const results = {
    polled: 0,
    opened_wos: [] as Array<{ machine: string; wo: string }>,
    skipped: [] as string[],
    errors: [] as string[],
  };

  try {
    if (!INTOUCH_URL || !INTOUCH_TOKEN) {
      throw new Error("Missing INTOUCH_API_URL or INTOUCH_API_TOKEN");
    }

    // Egress backoff: skip the entire poll until iTouching quota window resets.
    const blockedUntil = await intouchQuotaBlockedUntil();
    if (blockedUntil) {
      return new Response(JSON.stringify({
        ok: true,
        skipped: true,
        reason: "iTouching daily quota exhausted",
        retry_after: blockedUntil,
        created: 0,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }



    // 1. Active machines mapped to our system
    const { data: mapped, error: mErr } = await admin
      .from("intouch_machine_map")
      .select("intouch_machine_id, intouch_machine_name, machine_name, line_id, last_status, last_downtime_code, last_seen_at, stop_since_at, prod_dt_started_at, prod_dt_code, live_job_checked_at")
      .eq("active", true);
    if (mErr) throw mErr;
    if (!mapped?.length) {
      return new Response(JSON.stringify({ ok: true, message: "no mapped machines", ...results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    results.polled = mapped.length;

    // 2. Batch status call (wrapped so a transient iTouching outage does not
    //    abort the whole poll — we record the reason and exit cleanly).
    const ids = mapped.map((m) => m.intouch_machine_id);
    let statuses: Array<{ MachineID: string; Status: number; DowntimeCode?: string | null }> = [];
    try {
      statuses = await it(`/api/getmachineStatuses`, { method: "POST", body: JSON.stringify(ids) });
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      console.error("[intouch-poll] getmachineStatuses failed:", msg);
      results.errors.push(`getmachineStatuses: ${msg}`);
      try {
        await admin.from("intouch_sync_runs").insert({
          function_name: "intouch-poll",
          status: "error",
          error_message: msg,
          details: results as any,
          finished_at: new Date().toISOString(),
        });
      } catch (_) { /* best-effort */ }
      return new Response(JSON.stringify({ ok: false, error: msg, ...results }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve iTouching DowntimeCode UUIDs → friendly names.
    // To save iTouching API egress (100MB/day quota), prefer the labels we
    // already cached in intouch_stop_code_map and only fetch /api/DowntimeCode
    // when the current poll surfaces an unknown UUID.
    const { data: codeMap } = await admin
      .from("intouch_stop_code_map")
      .select("stop_code, label, default_priority, requires_wo, active");

    // The third time this file learns the same lesson, and the last map still
    // getting it wrong.
    //
    // This one was active-only, and it is what decides whether a stop is TRACKED
    // as production downtime: `isProdCode` reads it, and an inactive code returns
    // undefined, so the clock never starts. Every planned code in the Admin Centre
    // is currently inactive — Breaks, Brushing and Cleaning, Mechanical Stop, No
    // Planned Shift — so on 08/08 all ten mapped machines carried a stop code and
    // not one was being tracked. production_downtimes has had no rows since 29/07
    // for this reason, which in turn makes planned_stop_minutes() return zero for
    // every line, which is why the pace on the line board cannot yet deduct a deep
    // clean from the time a line is judged on.
    //
    // Deactivating a code in the Admin Centre says "stop offering this to
    // operators". It has never meant "stop measuring the stops we already see",
    // any more than it meant stop naming them or stop calling out an engineer.
    const codeLookup = new Map(
      (codeMap ?? []).map((c) => [normalizeStopCode(c.stop_code), c]),
    );

    // Naming is a different question, and it reads EVERY code, active or not.
    //
    // These two used to be the same map: an inactive code had no entry, so the label
    // fell back to the raw UUID and rows landed in production_downtimes with
    // "648BC304-8254-4A0F-B6D8-E19D2B8C59F1" as their reason. That is not just ugly —
    // "No Planned Shift" is excluded from downtime by matching its NAME, so 421
    // minutes of unscheduled time were counted as real stoppage on Line 4, and the
    // Breaks rows likewise. Deactivating a code must not change what a stop is called.
    const uuidToName = new Map<string, string>(
      (codeMap ?? []).map((c) => [normalizeStopCode(c.stop_code), c.label ?? ""]),
    );

    // Whether a stop raises an order is the same kind of question as what it is
    // called, and it reads EVERY code too.
    //
    // `requires_wo` is a standing instruction from an admin, not a live one, and
    // reading it through an active-only map meant a deactivated code fell through
    // the guard below as though nobody had ever mapped it. "Alarm" has been flagged
    // `requires_wo = false` since June and inactive since July, and it still raised
    // WO-639 and WO-640 on Line 2 — labelled "iTouching stop Alarm", because the
    // same miss sent the name down the fallback as well. Deactivating a code must
    // not change what a stop is called, and it must not change whether it calls out
    // an engineer.
    //
    // Now that `codeLookup` reads every code as well, this is that same map. Kept
    // under its own name because the question it answers is a different one, and
    // splitting them again is how the active-only filter came back the last time.
    const codeDecision = codeLookup;

    const seenCodes = new Set(
      (statuses ?? [])
        .map((s) => normalizeStopCode(s.DowntimeCode))
        .filter((k) => k.length > 0),
    );
    const unknownCodes = [...seenCodes].filter((k) => !codeLookup.has(k));

    // A code we have never seen is not the only reason to ask iTouching what its
    // codes are called. A code we already hold can be RENAMED there, and until
    // now nothing ever noticed: the upsert below carried ignoreDuplicates, so an
    // existing row's label was written once and never again.
    //
    // On 08/08 iTouching showed Filler Line 3 as "Filling Blender/ Blending" and
    // this system showed "Electrical Stop" — same GUID, two names, and the wrong
    // one was the one with requires_wo on it. A stop that raises an order under a
    // name nobody on the floor recognises is worse than no name at all.
    //
    // So it also refreshes on age. /api/DowntimeCode is a short list and this
    // asks for it at most once an hour, which is nothing against the daily egress
    // the poll already lives inside.
    const REFRESH_CODES_AFTER_MS = 60 * 60 * 1000;
    let codesAreStale = true;
    try {
      const { data: newest } = await admin
        .from("intouch_stop_code_map")
        .select("updated_at")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const last = newest?.updated_at ? new Date(newest.updated_at).getTime() : 0;
      codesAreStale = Date.now() - last > REFRESH_CODES_AFTER_MS;
    } catch { /* ask iTouching if we cannot tell */ }

    if (unknownCodes.length > 0 || codesAreStale) {
      try {
        const codes: Array<{ ID: string; Name: string; Active: boolean }> =
          await it(`/api/DowntimeCode`);
        if (codes?.length) {
          const seenIso = new Date().toISOString();
          for (const c of codes) {
            const k = normalizeStopCode(c.ID);
            if (k) uuidToName.set(k, c.Name ?? "");
          }

          // New codes arrive with requires_wo off. Whether a stop calls out an
          // engineer is an admin's decision, and a code appearing in a catalogue
          // is not that decision being made.
          await admin.from("intouch_stop_code_map").upsert(
            codes
              .filter((c) => c.ID)
              .map((c) => ({
                stop_code: normalizeStopCode(c.ID),
                label: c.Name || `iTouching ${c.ID}`,
                requires_wo: false,
                active: c.Active !== false,
                updated_at: seenIso,
              })),
            { onConflict: "stop_code", ignoreDuplicates: true },
          );

          // Existing codes: the NAME and whether iTouching still offers it belong
          // to iTouching and are taken from it. `requires_wo`, `category` and
          // `default_priority` belong to an admin here and are never touched —
          // which is the whole reason this is a second statement rather than an
          // upsert with ignoreDuplicates turned off.
          for (const c of codes) {
            const k = normalizeStopCode(c.ID);
            if (!k) continue;
            const row = codeLookup.get(k) as { label?: string | null; active?: boolean } | undefined;
            if (!row) continue; // just inserted above
            const name = c.Name || `iTouching ${c.ID}`;
            const stillOffered = c.Active !== false;
            if (row.label === name && row.active === stillOffered) continue;
            await admin.from("intouch_stop_code_map")
              .update({ label: name, active: stillOffered, updated_at: seenIso })
              .eq("stop_code", k);
            results.skipped.push(`stop code renamed: "${row.label}" → "${name}"`);
            // Keep this run honest too, rather than making the floor wait a minute
            // for the name it is already looking at on the iTouching screen.
            row.label = name;
            row.active = stillOffered;
          }

          // Stamp the whole set as seen, so the hourly check measures when we last
          // ASKED and not when a name last happened to change. Without this, a
          // catalogue that never changes would be re-fetched every single poll.
          await admin.from("intouch_stop_code_map")
            .update({ updated_at: seenIso })
            .in("stop_code", codes.filter((c) => c.ID).map((c) => normalizeStopCode(c.ID)));
        }
      } catch (e) {
        results.errors.push(`DowntimeCode list: ${(e as Error).message}`);
      }
    }


    const now = new Date().toISOString();

    for (const s of statuses) {
     try {
      const m = mapped.find((x) => x.intouch_machine_id === s.MachineID);
      if (!m) continue;


      const currentStatus = parseStatus(s.Status);
      const previousStatus = parseStatus(m.last_status);
      const rawDowntimeCode = s.DowntimeCode ?? null;
      const rawCodeKey = normalizeStopCode(rawDowntimeCode);
      const rawMappedCode = rawCodeKey ? codeLookup.get(rawCodeKey) : undefined;

      // An active stop code is a stop, whatever the status says — the rule, and
      // the evidence for it, are in `stopReading.ts`. It used to be the reverse
      // here: a code arriving on status 1 or 2 was deleted unless it required a
      // work order, which is how Filler Line 4 spent a 1:35 Deep Clean reading
      // RUNNING in green and left no downtime record behind it.
      const reading = readStop({
        status: currentStatus,
        rawCode: rawDowntimeCode,
        requiresWo: rawMappedCode?.requires_wo === true,
      });
      const currentDowntimeCode = reading.code;
      const codeKey = normalizeStopCode(currentDowntimeCode);
      const previousCodeKey = normalizeStopCode(m.last_downtime_code);
      const hadPreviousSnapshot = Boolean(m.last_seen_at);

      // How long this line has been down, for the board — and for nothing else.
      //
      // Not `prod_dt_started_at`. That column is the production-downtime ledger's
      // bookkeeping: it opens only for codes that do NOT require a work order, and
      // it is deliberately cleared when maintenance takes the stoppage over, so the
      // same minutes are not billed twice. Correct for the ledger, and useless as an
      // answer to "how long has this line been standing still" — which is the
      // question the performance board asks, and which came back null for 23 of the
      // 48 mapped codes. The card then filled the slot with the age of the last
      // poll: "Filling Blender/ Blending — 78s", on a stop that had run for hours.
      //
      // The same code still there → the clock is left alone. A different code, or a
      // stop where there was none → it starts now. No code at all → nothing to time.
      // The reading is stamped in the same statement as the status it belongs to, so
      // a machine can never be seen stopped with no clock on it.
      const stopSinceAt = !codeKey
        ? null
        : (previousCodeKey === codeKey && m.stop_since_at ? m.stop_since_at : now);

      // Persist last-seen status before deciding, so first poll becomes a safe baseline.
      // When the machine is healthy, clear any stale downtime code. A previous
      // reset that left status=running but kept a stop code must not count as a
      // real running → stopped transition later.
      //
      // Two versions of the clock above met here: this one guards on `codeKey`, the
      // normalised code, and the other on `currentDowntimeCode != null`. iTouching
      // sends an EMPTY STRING for a machine that is not stopped, and an empty string
      // is not null — so that guard put a stop clock on every running machine in the
      // factory. Harmless on screen, because the view refuses to time a line with no
      // code, and wrong in the table, which is where the next reader looks.
      await admin.from("intouch_machine_map").update({
        last_status: currentStatus,
        last_downtime_code: currentDowntimeCode,
        last_seen_at: now,
        stop_since_at: stopSinceAt,
        updated_at: now,
      }).eq("intouch_machine_id", s.MachineID);

      // The status is written above whatever the toggle says, so the screens stay
      // honest.
      //
      // This used to `continue` here, on the stated grounds that "everything past
      // this point either opens an order or edits one". That was not true, and the
      // untrue half is measurement: the production-downtime tracking below writes
      // `production_downtimes`, which is not an order and calls nobody out. With
      // the toggle off — which it has been — the poll read ten machines a minute
      // and recorded not one minute of stoppage. `production_downtimes` has been
      // empty since 29/07, and `planned_stop_minutes()` reads from it, so the line
      // board cannot deduct a deep clean from the time a line is judged on.
      //
      // The toggle now sits where its own comment says it belongs: in front of the
      // two blocks that touch a work order, and nowhere else. Measuring a stoppage
      // is reading. Calling out an engineer is the automatic act.

      if (currentStatus == null) {
        results.skipped.push(`${m.intouch_machine_name} (unknown status)`);
        continue;
      }

      const isDown = reading.isDown;
      const codeName = uuidToName.get(codeKey) ?? codeKey;
      const mapped_code = codeLookup.get(codeKey);
      const prevMappedCode = m.prod_dt_code ? codeLookup.get(normalizeStopCode(m.prod_dt_code)) : null;

      // ── Production-side downtime tracking (codes NOT flagged requires_wo) ──
      const isProdCode = !!mapped_code && mapped_code.requires_wo !== true;
      const wasTrackingProd = !!m.prod_dt_started_at;

      async function closeProdDowntime(endIso: string) {
        if (!m.prod_dt_started_at || !m.line_id) return;
        const startMs = new Date(m.prod_dt_started_at).getTime();
        const endMs = new Date(endIso).getTime();
        const mins = Math.max(1, Math.round((endMs - startMs) / 60000));
        // Resolve line name (text column on production_downtimes)
        const { data: ln } = await admin.from("lines").select("name").eq("id", m.line_id).maybeSingle();
        const lineLbl = ln?.name ?? "Unknown";
        const londonStart = new Date(new Date(m.prod_dt_started_at).toLocaleString("en-US", { timeZone: "Europe/London" }));
        const h = londonStart.getHours();
        const occurred_date = (h < 6
          ? new Date(londonStart.getTime() - 86400000)
          : londonStart).toISOString().slice(0, 10);
        const shift = (h >= 6 && h < 18) ? "DAY" : "NIGHT";
        // Name it from the full map, never from the UUID: an unnamed stop is invisible
        // to every rule that classifies downtime by its reason.
        const prevKey = m.prod_dt_code ? normalizeStopCode(m.prod_dt_code) : "";
        const reasonLbl =
          prevMappedCode?.label ||
          (prevKey ? uuidToName.get(prevKey) : "") ||
          (m.prod_dt_code ? `Unmapped stop code (${m.prod_dt_code})` : "iTouching stop");
        await admin.from("production_downtimes").insert({
          occurred_date,
          shift,
          line: lineLbl,
          category: prevMappedCode?.category || "Other",
          reason: reasonLbl,
          duration_minutes: mins,
          started_at: m.prod_dt_started_at,
          ended_at: endIso,
          notes: `[Auto from iTouching] machine=${m.intouch_machine_name} code=${m.prod_dt_code}`,
        });
      }

      // Resume (healthy) → stop the clock on this machine's open auto order.
      //
      // The poll used to walk away here: it closed its own production-downtime
      // tracking and left the work order with line_stopped = true and no
      // line_resumed_at, so the order kept accruing downtime until a person noticed.
      // That is the same shape as the 233,710 phantom minutes we had to cap by hand —
      // a clock nobody stopped, not a line that stayed down.
      //
      // The ORDER is not closed. iTouching knows the machine is running again; it does
      // not know whether the repair is finished, and closing is the maintenance
      // manager's signature to give.
      if (!isDown && autoWoEnabled) {
        try {
          const { data: resumedWOs } = await admin
            .from("work_orders")
            .update({
              line_stopped: false,
              line_resumed_at: now,
            })
            .eq("intouch_machine_id", s.MachineID)
            .in("status", ["open", "received", "arrived", "in_progress"])
            .eq("line_stopped", true)
            .is("line_resumed_at", null)
            .select("id, wo_number");
          for (const w of resumedWOs ?? []) {
            // The order's own stoppage ledger closes with it. An event left open
            // keeps the order un-closable — useCloseWorkOrder refuses while any
            // downtime_events row has no resumed_at.
            await admin
              .from("downtime_events")
              .update({ resumed_at: now, resumed_by_name: "iTouching", resumed_note: "Machine reported running by iTouching" })
              .eq("work_order_id", w.id)
              .is("resumed_at", null);
            results.opened_wos.push({
              machine: m.machine_name ?? m.intouch_machine_name ?? "?",
              wo: `${w.wo_number} line resumed (iTouching reports the machine running)`,
            });
          }
        } catch (e) {
          results.errors.push(`wo resume ${m.intouch_machine_name}: ${(e as Error).message}`);
        }
      }

      // Resume (healthy) → close any open production downtime
      if (!isDown && wasTrackingProd) {
        try { await closeProdDowntime(now); } catch (e) { results.errors.push(`prod-dt close ${m.intouch_machine_name}: ${(e as Error).message}`); }
        await admin.from("intouch_machine_map")
          .update({ prod_dt_started_at: null, prod_dt_code: null })
          .eq("intouch_machine_id", s.MachineID);
      }

      // Down with a prod-side code
      if (isDown && isProdCode) {
        // Different code than the one currently tracked → close & restart
        if (wasTrackingProd && normalizeStopCode(m.prod_dt_code) !== codeKey) {
          try { await closeProdDowntime(now); } catch (e) { results.errors.push(`prod-dt switch ${m.intouch_machine_name}: ${(e as Error).message}`); }
          await admin.from("intouch_machine_map")
            .update({ prod_dt_started_at: now, prod_dt_code: s.DowntimeCode })
            .eq("intouch_machine_id", s.MachineID);
        } else if (!wasTrackingProd) {
          await admin.from("intouch_machine_map")
            .update({ prod_dt_started_at: now, prod_dt_code: s.DowntimeCode })
            .eq("intouch_machine_id", s.MachineID);
        }
        results.skipped.push(`${m.intouch_machine_name} (${codeName} → production downtime)`);
        continue;
      }

      // Past here the poll only opens or edits work orders, which is what the
      // toggle exists to hold back. The stoppage above was measured either way.
      if (!autoWoEnabled) {
        results.skipped.push(`${m.intouch_machine_name} (status read; auto orders are OFF)`);
        continue;
      }

      if (!isDown) continue;

      if (!m.line_id) {
        results.skipped.push(`${m.intouch_machine_name} (no line mapped)`);
        continue;
      }

      // Mapeada a uma linha, sim — mas à linha certa? A regra e o caso que a
      // obrigou estão em `mappingIntegrity.ts`. Aqui só se lê o árbitro
      // (`machines.line_id`) e se obedece: um mapa que se contradiz não diz
      // onde a paragem foi, e uma ordem aberta na dúvida chama a manutenção a
      // uma linha que está a trabalhar.
      if (m.machine_name) {
        try {
          const { data: mach } = await admin
            .from("machines").select("line_id").eq("name", m.machine_name).maybeSingle();
          // Os nomes das duas linhas em conflito, só para a mensagem: quem a lê
          // vai ao ecrã de mapeamento, e lá as linhas têm nome, não UUID.
          const conflictIds = [m.line_id, mach?.line_id].filter(Boolean) as string[];
          const { data: lnRows } = conflictIds.length
            ? await admin.from("lines").select("id, name").in("id", conflictIds)
            : { data: [] as Array<{ id: string; name: string }> };
          const lineNameById = new Map((lnRows ?? []).map((l: any) => [l.id, l.name as string]));
          const verdict = checkMachineLine({
            machineName: m.machine_name,
            mapLineId: m.line_id,
            // `maybeSingle` devolve null quando não há linha nenhuma: isso é
            // "a tabela não conhece a máquina", que a regra cala de propósito.
            machineLineId: mach ? mach.line_id : undefined,
            mapLineName: lineNameById.get(m.line_id) ?? null,
            machineLineName: mach?.line_id ? lineNameById.get(mach.line_id) ?? null : null,
          });
          if (!verdict.ok) {
            // Em `errors`, não em `skipped`: isto não é uma paragem que não dá
            // ordem, é uma configuração partida que precisa de mão humana.
            results.errors.push(`${m.intouch_machine_name}: ${verdict.reason}`);
            continue;
          }
        } catch (e) {
          // A verificação não pode ser ela própria um motivo para não abrir a
          // ordem: se a leitura falhar, segue-se em frente como antes dela.
          console.error("[intouch-poll] machine/line integrity check failed", {
            machine: m.machine_name, error: (e as Error).message,
          });
        }
      }

      // Two reasons not to raise an order, and both have to be checked here rather
      // than left to the database.
      //
      // `requires_wo = false` is an admin's standing decision, read from the full map
      // so deactivating a code does not silently revoke it.
      //
      // An unmapped code is the one that used to freeze a machine. This comment said
      // "still open a WO, don't drop the stop" — but `enforce_intouch_wo_requires_maintenance_code`
      // refuses exactly that insert and returns NULL, so the row never appears, the
      // `.single()` below fails with "Cannot coerce the result to a single JSON
      // object", the loop hits `continue`, and the machine's state is never written.
      // Every minute, for ever. Filler Line 5 sat like that from 16:50 on 04/08 while
      // its stop code — "Filling Blender/ Blending" — was missing from the map, and
      // Line 1's order went on reading "Electrical Stop" because nothing about that
      // machine could be updated either.
      //
      // The database is the authority on this, so the poll stops arguing with it and
      // says plainly what it saw instead.
      const decided = codeDecision.get(codeKey);
      if (decided && decided.requires_wo === false) {
        results.skipped.push(`${m.intouch_machine_name} (${codeName} flagged production-only)`);
        continue;
      }
      if (!decided) {
        results.skipped.push(`${m.intouch_machine_name} (${codeName} is not in the stop code map — no order raised)`);
        continue;
      }

      const label = decided?.label ?? `iTouching stop ${codeName}`;
      const priority = (decided?.default_priority ?? "medium") as string;

      // Look up an active WO for this machine. If one exists, never create
      // another order for the same stopped machine. Check both the iTouching
      // GUID and legacy machine names because older WOs may not have the GUID.
      const recentCutoff = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
      const activeStatuses = ["open", "received", "arrived", "in_progress"];
      const machineNames = Array.from(new Set([m.machine_name, m.intouch_machine_name].filter(Boolean))) as string[];

      // Every order still live on this machine, not just the newest one.
      //
      // The order that matters is the one raised for THIS problem. A machine can be
      // down for a capper jam while an engineer is still finishing a labeller fault:
      // two problems, two repairs, two orders. Taking only the most recent order and
      // rewriting its stop code merged them into one, and whichever fault was fixed
      // second inherited the first one's history.
      let { data: activeWOs } = await admin
        .from("work_orders")
        .select("id, wo_number, intouch_downtime_code, notes")
        .eq("intouch_machine_id", s.MachineID)
        .in("status", activeStatuses)
        .order("created_at", { ascending: false });

      if ((!activeWOs || activeWOs.length === 0) && machineNames.length) {
        const legacy = await admin
          .from("work_orders")
          .select("id, wo_number, intouch_downtime_code, notes")
          .in("machine", machineNames)
          .in("status", activeStatuses)
          .gte("created_at", recentCutoff)
          .order("created_at", { ascending: false });
        activeWOs = legacy.data ?? [];
      }

      // Same problem → the same order picks the clock back up. Matching on the code
      // rather than on "the newest order" also survives a stop code that flaps: the
      // order for that code is found again instead of a third one being raised.
      let existing = (activeWOs ?? []).find(
        (w) => normalizeStopCode(w.intouch_downtime_code) === codeKey,
      ) ?? null;

      // A person got there first.
      //
      // The lookup above finds orders by `intouch_machine_id` and then keeps the one
      // carrying this stop code. An order raised from a tablet has neither, so it is
      // invisible here and the poll raises its own for a fault somebody has already
      // reported: Murilo opened WO-703 for a sensor issue on Line 4 at 15:40:31 and
      // the poll opened WO-704 for the same fault thirty-one seconds later.
      //
      // Same line, same problem, still open, raised in the last hour — that is the
      // same fault, and the order that exists wins. It is stamped with the iTouching
      // identifiers so every later poll recognises it through the check above rather
      // than coming back here.
      if (!existing && m.line_id) {
        const { data: human } = await admin
          .from("work_orders")
          .select("id, wo_number, intouch_downtime_code, notes")
          .eq("line_id", m.line_id)
          .is("intouch_downtime_code", null)
          .eq("description", label)
          .in("status", activeStatuses)
          .gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString())
          .order("created_at", { ascending: false })
          .limit(1);
        const adopted = human?.[0] ?? null;
        if (adopted) {
          await admin.from("work_orders")
            .update({ intouch_machine_id: s.MachineID, intouch_downtime_code: s.DowntimeCode })
            .eq("id", adopted.id);
          results.skipped.push(`${m.intouch_machine_name} (${codeName} → already reported on WO-${adopted.wo_number})`);
          existing = { ...adopted, intouch_downtime_code: s.DowntimeCode };
        }
      }
      const otherActiveWOs = (activeWOs ?? []).filter((w) => w.id !== existing?.id);

      if (existing) {
        // The poll resumed this order when the machine recovered; it has now failed
        // again before anybody closed the order. That is a second stoppage, not a
        // continuation — recorded as its own episode so the order does not silently
        // absorb it, and so the minutes between the two failures are not counted as
        // downtime.
        try {
          const { data: woNow } = await admin
            .from("work_orders")
            .select("line_stopped, line_resumed_at")
            .eq("id", existing.id)
            .maybeSingle();
          if (woNow && !woNow.line_stopped) {
            const { count: episodes } = await admin
              .from("downtime_events")
              .select("id", { count: "exact", head: true })
              .eq("work_order_id", existing.id);
            await admin.from("downtime_events").insert({
              work_order_id: existing.id,
              stopped_at: now,
              stopped_by_name: "iTouching",
              stopped_reason: codeName,
              is_recurrence: true,
              episode_number: (episodes ?? 0) + 1,
            });
            await admin.from("work_orders")
              .update({ line_stopped: true, line_resumed_at: null })
              .eq("id", existing.id);
            results.opened_wos.push({
              machine: m.machine_name ?? m.intouch_machine_name ?? "?",
              wo: `${existing.wo_number} stopped again (${codeName})`,
            });
          }
        } catch (e) {
          results.errors.push(`wo re-stop ${m.intouch_machine_name}: ${(e as Error).message}`);
        }

        results.skipped.push(`${m.intouch_machine_name} (WO ${existing.wo_number} already open for ${codeName})`);
        continue;
      }

      const changedMaintenanceCode = hadPreviousSnapshot
        && !!codeKey
        && previousCodeKey !== codeKey
        && mapped_code?.requires_wo === true;
      const cameFromHealthy = hadPreviousSnapshot
        && previousStatus != null
        && HEALTHY_STATUS.has(previousStatus)
        && !previousCodeKey;
      // Never synthesize a running baseline while the machine is still stopped.
      // A new WO is created only on a real transition observed by the poll:
      // previous iTouching status was running/healthy with no active stop code,
      // current status is stopped. This prevents delete → recreate loops when
      // the line remains stopped or when a bad reset left a stale stop code.
      // A machine already has an order open, but for a DIFFERENT code: this is a new
      // fault on a machine somebody is still repairing, and it gets its own order.
      // The baseline guard below is about not re-raising an order for a stop that was
      // already there — it does not apply to a problem nobody has an order for.
      const anotherProblemInProgress = otherActiveWOs.length > 0;

      if (!cameFromHealthy && !changedMaintenanceCode && !anotherProblemInProgress) {
        results.skipped.push(`${m.intouch_machine_name} (${codeName} baseline/no new stop)`);
        continue;
      }

      // If we were tracking a prod-side downtime, close it now — maintenance takes over.
      if (wasTrackingProd) {
        try { await closeProdDowntime(now); } catch (e) { results.errors.push(`prod-dt handover ${m.intouch_machine_name}: ${(e as Error).message}`); }
        await admin.from("intouch_machine_map")
          .update({ prod_dt_started_at: null, prod_dt_code: null })
          .eq("intouch_machine_id", s.MachineID);
      }


      // Requester = the line's shift leader, not "iTouching". Prefer the leader
      // ASSIGNED to the current session (production_sessions.leader_name); fall
      // back to the registered line leader, then to "<Line> Leader".
      let requesterName = "iTouching";
      try {
        const { data: ln0 } = await admin.from("lines").select("name").eq("id", m.line_id).maybeSingle();
        const lineName: string | null = ln0?.name ?? null;
        if (lineName) {
          const { date: sd, shift: sh } = currentShiftLondon();
          const { data: sess } = await admin.from("production_sessions")
            .select("leader_name").ilike("line", lineName).eq("shift", sh).eq("session_date", sd)
            .not("leader_name", "is", null).limit(1).maybeSingle();
          if (sess?.leader_name) {
            requesterName = `${sess.leader_name} (${lineName})`;
          } else {
            const { data: leader } = await admin.from("line_leaders")
              .select("name").ilike("line", lineName).in("shift", [sh, "BOTH"]).eq("active", true)
              .limit(1).maybeSingle();
            requesterName = leader?.name ? `${leader.name} (${lineName})` : `${lineName} Leader`;
          }
        }
      } catch { /* keep the iTouching fallback */ }

      const { data: wo, error: woErr } = await admin
        .from("work_orders")
        .insert({
          requester_name: requesterName,
          machine: m.machine_name ?? m.intouch_machine_name,
          line_id: m.line_id,
          description: label,
          priority,
          status: "open",
          intouch_machine_id: s.MachineID,
          intouch_downtime_code: s.DowntimeCode,
          // Written for the engineer who opens the order, not for a debugger.
          // This used to print the raw downtime GUID and the numeric iTouching
          // status, which meant nothing on the floor and got mistaken for a
          // different stop code than the one shown in the mapping screen.
          notes: `${label} detected automatically by iTouching.\n`
               + `Machine: ${m.intouch_machine_name}\n`
               + `Detected: ${new Date(now).toLocaleString("en-GB", { timeZone: "Europe/London" })}`,
          line_stopped: true,
          line_stopped_at: now,
        })
        .select("id, wo_number")
        .maybeSingle();
      if (woErr || !wo) {
        // maybeSingle rather than single: a trigger that refuses the row returns
        // nothing, and "Cannot coerce the result to a single JSON object" told
        // nobody that a stop code was unmapped.
        results.errors.push(
          `${m.intouch_machine_name}: ${woErr?.message ?? `order refused for ${codeName} — check the stop code mapping`}`,
        );
        continue;
      }
      results.opened_wos.push({ machine: m.machine_name ?? m.intouch_machine_name ?? "?", wo: String(wo.wo_number) });
      const { data: ln } = await admin.from("lines").select("name").eq("id", m.line_id).maybeSingle();
      await notifyEngineersNewWO({
        woId: wo.id,
        woNumber: wo.wo_number,
        machine: m.machine_name ?? m.intouch_machine_name ?? null,
        line: ln?.name ?? null,
        description: label,
        priority,
      });

     } catch (perMachineErr) {
       const msg = (perMachineErr as Error).message ?? String(perMachineErr);
       console.error(`[intouch-poll] machine ${s.MachineID} failed:`, msg);
       results.errors.push(`machine ${s.MachineID}: ${msg}`);
       continue;
     }
    }

    // ── What each machine is MAKING ────────────────────────────────────────────
    //
    // Runs after the status loop and can never disturb it: a failure here is
    // recorded and the poll still returns whatever the statuses said.
    //
    // WHY THIS IS HERE AT ALL. On 12/08 at 11:04 UTC Line 2 sat in "Line
    // Preparation" with zero `production_items` — the 1.832 on its card had been
    // Line 3's production logged on the wrong line and were deleted — so the board
    // could not name the product the line was being set up for, while the
    // iTouching screen beside it could. Nothing in this database held that answer:
    // `production_orders` has been empty since it was created, this table had no
    // product column, and `rag_weekly_entries` carries a plan quantity with no SKU.
    //
    // THE EGRESS, WHICH IS THE REASON IT LOOKS LIKE THIS. `getscheduledjobs` takes
    // one machine per call, and iTouching enforces a daily egress cap that this
    // function already backs off from — ten calls a minute on top of the status
    // batch would be 14.400 a day. So each machine is refreshed at most every five
    // minutes and at most four are asked per run: ~1 extra call a minute, and the
    // ten machines all come round inside three minutes. The board refuses a job it
    // has not seen for half an hour, so a stalled refresh empties the slot rather
    // than leaving a product on a card nobody confirmed.
    const JOB_REFRESH_MS = 5 * 60 * 1000;
    const JOB_MAX_PER_RUN = 4;
    const jobCheckedAt = (m: { live_job_checked_at?: string | null }) =>
      m.live_job_checked_at ? new Date(m.live_job_checked_at).getTime() : 0;
    const jobsDue = mapped
      .filter((m) => Date.now() - jobCheckedAt(m) >= JOB_REFRESH_MS)
      // Longest unchecked first, so one machine can never starve the others.
      .sort((a, b) => jobCheckedAt(a) - jobCheckedAt(b))
      .slice(0, JOB_MAX_PER_RUN);

    for (const m of jobsDue) {
      const askedAt = new Date().toISOString();
      try {
        const raw = await it(`/api/appapi/getscheduledjobs?MachineID=${encodeURIComponent(m.intouch_machine_id)}`);
        const job = pickRunningJob(raw);
        // Written in one statement, including the nulls: a machine with no job
        // must have its slot CLEARED, or yesterday's product outlives the job.
        await admin.from("intouch_machine_map").update({
          live_job_code: job?.code ?? null,
          live_job_name: job?.name ?? null,
          live_job_qty: job?.qty ?? null,
          live_job_state: job?.state ?? null,
          live_job_seen_at: job ? askedAt : null,
          live_job_checked_at: askedAt,
        }).eq("intouch_machine_id", m.intouch_machine_id);
        results.skipped.push(job
          ? `${m.intouch_machine_name} job: ${job.state} ${job.code}`
          : `${m.intouch_machine_name} job: none scheduled`);
      } catch (e) {
        // The quota is the one failure worth abandoning the whole sweep for —
        // asking the remaining machines would only deepen the hole.
        if (e instanceof ItouchQuotaError) {
          results.skipped.push(`job lookup stopped: iTouching quota exhausted`);
          break;
        }
        // Anything else: stamp the attempt so it does not retry every minute, and
        // leave the last known job alone — the board ages it out on its own.
        await admin.from("intouch_machine_map")
          .update({ live_job_checked_at: askedAt })
          .eq("intouch_machine_id", m.intouch_machine_id);
        // `skipped`, not `errors`: a job lookup that failed is not a poll that
        // failed, and marking the run red would train whoever reads these to
        // ignore red. It is still written down, because a lookup that has been
        // failing for a week must not look like a line with nothing scheduled.
        results.skipped.push(`${m.intouch_machine_name} job lookup: ${(e as Error).message.slice(0, 120)}`);
      }
    }

    // Record successful poll outcome
    try {
      await admin.from("intouch_sync_runs").insert({
        function_name: "intouch-poll",
        status: results.errors.length ? "error" : "success",
        details: results as any,
        error_message: results.errors.length ? results.errors.join(" | ").slice(0, 1000) : null,
        finished_at: new Date().toISOString(),
      });
    } catch (_) { /* best-effort */ }

    // 3. SKU sync removed — SKUs come exclusively from manual
    //    "Import iTouching (Work To List)" in the Planner page.
    //    intouch-poll only opens Work Orders on stop codes; it must never
    //    create production_sessions / production_items / sku_products.



    console.log("intouch-poll result", JSON.stringify(results));
    const debug = new URL(req.url).searchParams.get("debug") === "1";
    // Said in the response, because "polled: 10, opened_wos: []" and "polled: 10,
    // opened_wos: [] because orders are switched off" look identical otherwise, and
    // somebody reading the logs has to be able to tell them apart.
    const payload: any = { ok: true, auto_wo_enabled: autoWoEnabled, ...results };
    if (debug) {
      payload.raw_statuses = statuses.map((s) => ({
        MachineID: s.MachineID,
        Status: s.Status,
        DowntimeCode: s.DowntimeCode ?? null,
        name: mapped.find((m) => m.intouch_machine_id === s.MachineID)?.intouch_machine_name,
      }));
    }
    return new Response(JSON.stringify(payload), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    console.error("[intouch-poll] fatal:", msg, (e as Error).stack);
    try {
      await admin.from("intouch_sync_runs").insert({
        function_name: "intouch-poll",
        status: "error",
        error_message: msg.slice(0, 1000),
        details: results as any,
        finished_at: new Date().toISOString(),
      });
    } catch (_) { /* best-effort */ }
    return new Response(JSON.stringify({ ok: false, error: msg, ...results }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
