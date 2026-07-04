// Polls the iTouching API for the live status of mapped machines and opens
// a maintenance Work Order when a machine enters a downtime state. Designed
// to be called every 1-2 minutes by pg_cron.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

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

// iTouching status codes: only a confirmed transition into downtime with an
// explicitly approved DowntimeCode may open a WO. This prevents stale/old stop
// codes from creating orders when a machine is first mapped or re-enabled.
const HEALTHY_STATUS = new Set<number>([1, 2]);

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
        action_url: `/dashboard/work-orders/${opts.woId}`,
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
  // When OFF, the cron / manual poll runs but does NOT open any Work Order.
  try {
    const { data: ss } = await admin
      .from("system_settings")
      .select("intouch_auto_wo_enabled")
      .limit(1)
      .maybeSingle();
    if (!ss?.intouch_auto_wo_enabled) {
      return new Response(JSON.stringify({
        ok: true,
        paused: true,
        reason: "intouch_auto_wo_enabled is OFF",
        polled: 0,
        opened_wos: [],
        skipped: [],
        errors: [],
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (_e) { /* fall through and run normally if flag read fails */ }


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
      .select("intouch_machine_id, intouch_machine_name, machine_name, line_id, last_status, last_downtime_code, last_seen_at, prod_dt_started_at, prod_dt_code")
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
      .select("stop_code, label, default_priority, requires_wo")
      .eq("active", true);
    const codeLookup = new Map(
      (codeMap ?? []).map((c) => [normalizeStopCode(c.stop_code), c]),
    );
    const uuidToName = new Map<string, string>(
      (codeMap ?? []).map((c) => [normalizeStopCode(c.stop_code), c.label ?? ""]),
    );

    const seenCodes = new Set(
      (statuses ?? [])
        .map((s) => normalizeStopCode(s.DowntimeCode))
        .filter((k) => k.length > 0),
    );
    const unknownCodes = [...seenCodes].filter((k) => !codeLookup.has(k));

    if (unknownCodes.length > 0) {
      try {
        const codes: Array<{ ID: string; Name: string; Active: boolean }> =
          await it(`/api/DowntimeCode`);
        if (codes?.length) {
          for (const c of codes) {
            const k = normalizeStopCode(c.ID);
            if (k) uuidToName.set(k, c.Name ?? "");
          }
          await admin.from("intouch_stop_code_map").upsert(
            codes
              .filter((c) => c.ID)
              .map((c) => ({
                stop_code: normalizeStopCode(c.ID),
                label: c.Name || `iTouching ${c.ID}`,
                requires_wo: false,
                active: c.Active !== false,
              })),
            { onConflict: "stop_code", ignoreDuplicates: true },
          );
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
      const currentIsHealthy = currentStatus != null && HEALTHY_STATUS.has(currentStatus);
      const rawDowntimeCode = s.DowntimeCode ?? null;
      const rawCodeKey = normalizeStopCode(rawDowntimeCode);
      const rawMappedCode = rawCodeKey ? codeLookup.get(rawCodeKey) : undefined;

      // Some iTouching screens keep Status=1 (running) while the operator has
      // already selected a maintenance stop reason. If that reason is explicitly
      // configured as requires_wo=true, treat it as a maintenance stop anyway.
      const maintenanceCodeWhileHealthy = currentIsHealthy
        && !!rawCodeKey
        && rawMappedCode?.requires_wo === true;
      const currentDowntimeCode = currentIsHealthy && !maintenanceCodeWhileHealthy ? null : rawDowntimeCode;
      const codeKey = normalizeStopCode(currentDowntimeCode);
      const previousCodeKey = normalizeStopCode(m.last_downtime_code);
      const hadPreviousSnapshot = Boolean(m.last_seen_at);

      // Persist last-seen status before deciding, so first poll becomes a safe baseline.
      // When the machine is healthy, clear any stale downtime code. A previous
      // reset that left status=running but kept a stop code must not count as a
      // real running → stopped transition later.
      await admin.from("intouch_machine_map").update({
        last_status: currentStatus,
        last_downtime_code: currentDowntimeCode,
        last_seen_at: now,
        updated_at: now,
      }).eq("intouch_machine_id", s.MachineID);

      if (currentStatus == null) {
        results.skipped.push(`${m.intouch_machine_name} (unknown status)`);
        continue;
      }

      const isDown = !!codeKey && (!currentIsHealthy || maintenanceCodeWhileHealthy);
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
        const reasonLbl = prevMappedCode?.label ?? m.prod_dt_code ?? "iTouching stop";
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

      if (!isDown) continue;

      if (!m.line_id) {
        results.skipped.push(`${m.intouch_machine_name} (no line mapped)`);
        continue;
      }

      // If the code has no mapping yet, still open a WO (don't drop the stop).
      // Only skip when an admin explicitly marked requires_wo = false.
      if (mapped_code && mapped_code.requires_wo === false) {
        results.skipped.push(`${m.intouch_machine_name} (${codeName} flagged production-only)`);
        continue;
      }

      const label = mapped_code?.label ?? `iTouching stop ${codeName}`;
      const priority = (mapped_code?.default_priority ?? "medium") as string;

      // Look up an active WO for this machine. If one exists, never create
      // another order for the same stopped machine. Check both the iTouching
      // GUID and legacy machine names because older WOs may not have the GUID.
      const recentCutoff = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
      const activeStatuses = ["open", "received", "arrived", "in_progress"];
      const machineNames = Array.from(new Set([m.machine_name, m.intouch_machine_name].filter(Boolean))) as string[];

      let { data: existing } = await admin
        .from("work_orders")
        .select("id, wo_number, intouch_downtime_code, notes")
        .eq("intouch_machine_id", s.MachineID)
        .in("status", activeStatuses)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!existing && machineNames.length) {
        const legacy = await admin
          .from("work_orders")
          .select("id, wo_number, intouch_downtime_code, notes")
          .in("machine", machineNames)
          .in("status", activeStatuses)
          .gte("created_at", recentCutoff)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        existing = legacy.data;
      }

      if (existing) {
        if (normalizeStopCode(existing.intouch_downtime_code) !== codeKey) {
          await admin.from("work_orders").update({
            intouch_downtime_code: s.DowntimeCode,
            description: label,
            priority,
            notes: `${existing.notes ?? ""}\n[Updated from iTouching @ ${now}] Stop code changed → ${codeName} (${s.DowntimeCode})`,
          }).eq("id", existing.id);
          results.opened_wos.push({ machine: m.machine_name ?? m.intouch_machine_name ?? "?", wo: `${existing.wo_number} updated → ${label}` });
        } else {
          results.skipped.push(`${m.intouch_machine_name} (WO ${existing.wo_number} already open)`);
        }
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
      if (!cameFromHealthy && !changedMaintenanceCode) {
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


      const { data: wo, error: woErr } = await admin
        .from("work_orders")
        .insert({
          requester_name: "iTouching",
          machine: m.machine_name ?? m.intouch_machine_name,
          line_id: m.line_id,
          description: label,
          priority,
          status: "open",
          intouch_machine_id: s.MachineID,
          intouch_downtime_code: s.DowntimeCode,
          notes: `[Auto-created from iTouching poll]\nMachine: ${m.intouch_machine_name}\nStatus: ${s.Status}\nDowntime code: ${s.DowntimeCode}`,
          line_stopped: true,
          line_stopped_at: now,
        })
        .select("id, wo_number")
        .single();
      if (woErr) {
        results.errors.push(`${m.intouch_machine_name}: ${woErr.message}`);
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
    const payload: any = { ok: true, ...results };
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
