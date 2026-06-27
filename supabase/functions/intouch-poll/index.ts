// Polls the iTouching API for the live status of mapped machines and opens
// a maintenance Work Order when a machine enters a downtime state. Designed
// to be called every 1-2 minutes by pg_cron.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTOUCH_URL = (Deno.env.get("INTOUCH_API_URL") ?? "").replace(/\/+$/, "");
const INTOUCH_TOKEN = Deno.env.get("INTOUCH_API_TOKEN") ?? "";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

// iTouching status codes: only a confirmed transition into downtime with an
// explicitly approved DowntimeCode may open a WO. This prevents stale/old stop
// codes from creating orders when a machine is first mapped or re-enabled.
const HEALTHY_STATUS = new Set<number>([1, 2]);

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

    // Ensure production_items exist (do NOT overwrite target/actual)
    const skuIds = codes.map((c) => idByCode.get(c)).filter(Boolean) as string[];
    if (skuIds.length === 0) continue;
    const { data: existItems } = await admin
      .from("production_items")
      .select("sku_id")
      .eq("session_id", session.id)
      .in("sku_id", skuIds);
    const haveSku = new Set((existItems ?? []).map((r: any) => r.sku_id));
    const rows = skuIds
      .filter((id) => !haveSku.has(id))
      .map((id) => ({
        session_id: session.id,
        sku_id: id,
        target_qty: 0,
        planned_qty: 0,
        actual_qty: 0,
        notes: "auto:itouching",
      }));
    if (rows.length) await admin.from("production_items").insert(rows);
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

  if (!cronSecret && !cronTriggerToken) {
    console.error("[intouch-poll][auth] CRON_SECRET/CRON_TRIGGER_TOKEN are not configured; refusing all requests.");
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

  let allowed = matches(cronSecret) || matches(cronTriggerToken);

  // Also allow an authenticated admin/manager (e.g. Sync Now from the UI).
  if (!allowed && bearer) {
    try {
      const { data, error } = await admin.auth.getUser(bearer);
      if (!error && data?.user?.id) {
        const { data: roles } = await admin
          .from("user_roles")
          .select("role")
          .eq("user_id", data.user.id);
        if ((roles ?? []).some((r: any) => r.role === "admin" || r.role === "manager")) {
          allowed = true;
        }
      }
    } catch (_) { /* fall through to 401 */ }
  }

  if (!allowed) {
    console.warn("[intouch-poll][auth] unauthorized call", {
      hasXCronSecretHeader: providedHeader.length > 0,
      hasBearer: bearer.length > 0,
      ua: req.headers.get("user-agent") ?? null,
      from: req.headers.get("x-forwarded-for") ?? null,
    });
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

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

    // 2. Batch status call
    const ids = mapped.map((m) => m.intouch_machine_id);
    const statuses: Array<{ MachineID: string; Status: number; DowntimeCode?: string | null }> =
      await it(`/api/getmachineStatuses`, { method: "POST", body: JSON.stringify(ids) });

    // Resolve iTouching DowntimeCode UUIDs → friendly names
    let uuidToName = new Map<string, string>();
    try {
      const codes: Array<{ ID: string; Name: string; Active: boolean }> =
        await it(`/api/DowntimeCode`);
      uuidToName = new Map(
        (codes ?? []).map((c) => [String(c.ID).toLowerCase(), c.Name ?? ""]),
      );

      // Auto-seed the stop-code map (requires_wo defaults FALSE on first sight
      // so the admin can opt-in per code; existing rows are preserved).
      if (codes?.length) {
        await admin.from("intouch_stop_code_map").upsert(
          codes
            .filter((c) => c.ID)
            .map((c) => ({
              stop_code: String(c.ID).toLowerCase(),
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

    const { data: codeMap } = await admin
      .from("intouch_stop_code_map")
      .select("stop_code, label, default_priority, requires_wo")
      .eq("active", true);
    const codeLookup = new Map(
      (codeMap ?? []).map((c) => [normalizeStopCode(c.stop_code), c]),
    );


    const now = new Date().toISOString();

    for (const s of statuses) {
      const m = mapped.find((x) => x.intouch_machine_id === s.MachineID);
      if (!m) continue;

      const currentStatus = parseStatus(s.Status);
      const previousStatus = parseStatus(m.last_status);
      const currentIsHealthy = currentStatus != null && HEALTHY_STATUS.has(currentStatus);
      const currentDowntimeCode = currentIsHealthy ? null : (s.DowntimeCode ?? null);
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

      const isDown = !currentIsHealthy && !!codeKey;
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
          category: "Other",
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

      const cameFromHealthy = hadPreviousSnapshot
        && previousStatus != null
        && HEALTHY_STATUS.has(previousStatus)
        && !previousCodeKey;
      // Never synthesize a running baseline while the machine is still stopped.
      // A new WO is created only on a real transition observed by the poll:
      // previous iTouching status was running/healthy with no active stop code,
      // current status is stopped. This prevents delete → recreate loops when
      // the line remains stopped or when a bad reset left a stale stop code.
      if (!cameFromHealthy) {
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

    }

    // 3. SKU sync removed — SKUs come exclusively from manual
    //    "Import iTouching (Work To List)" in the Planner page.
    //    intouch-poll only opens Work Orders on stop codes; it must never
    //    create production_sessions / production_items / sku_products.



    console.log("intouch-poll result", JSON.stringify(results));
    return new Response(JSON.stringify({ ok: true, ...results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message, ...results }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
