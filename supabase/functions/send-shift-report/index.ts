import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";

const BodySchema = z.object({
  shift: z.enum(["day", "night"]),
  dateISO: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  testRecipient: z.string().email().max(255).optional(),
});

function fmtMin(m: number) {
  if (!Number.isFinite(m) || m <= 0) return "0m";
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return h ? `${h}h ${r}m` : `${r}m`;
}

function escHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ---------- London time helpers ---------- */
function getLondonOffsetMinutes(at: Date): number {
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = dtf.formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUTC = Date.UTC(
    get("year"), get("month") - 1, get("day"),
    get("hour"), get("minute"), get("second"),
  );
  return Math.round((asUTC - at.getTime()) / 60_000);
}
function londonDateAtHour(dateISO: string, hour: number): Date {
  const naiveUtc = new Date(`${dateISO}T${String(hour).padStart(2, "0")}:00:00Z`);
  const off = getLondonOffsetMinutes(naiveUtc);
  return new Date(naiveUtc.getTime() - off * 60_000);
}
function londonTodayISO(at = new Date()): string {
  const dtf = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });
  return dtf.format(at);
}
function shiftWindow(shift: "day" | "night", dateISO: string): { start: Date; end: Date; label: string } {
  if (shift === "day") {
    return { start: londonDateAtHour(dateISO, 6), end: londonDateAtHour(dateISO, 18), label: "Day Shift (06:00–18:00)" };
  }
  const next = new Date(dateISO + "T00:00:00Z");
  next.setUTCDate(next.getUTCDate() + 1);
  const nextISO = next.toISOString().slice(0, 10);
  return { start: londonDateAtHour(dateISO, 18), end: londonDateAtHour(nextISO, 6), label: "Night Shift (18:00–06:00)" };
}
function overlapMs(aS: number, aE: number, bS: number, bE: number): number {
  return Math.max(0, Math.min(aE, bE) - Math.max(aS, bS));
}

/* ---------- Reconciliation: merge overlapping intervals ---------- */
function reconcileMinutes(
  recs: { start: string; end: string | null }[],
  windowStart: number,
  windowEnd: number,
): number {
  const segs: [number, number][] = [];
  for (const r of recs) {
    const s = Math.max(new Date(r.start).getTime(), windowStart);
    const e = Math.min(r.end ? new Date(r.end).getTime() : Date.now(), windowEnd);
    if (e > s) segs.push([s, e]);
  }
  segs.sort((a, b) => a[0] - b[0]);
  let total = 0; let curS = -1; let curE = -1;
  for (const [s, e] of segs) {
    if (s > curE) { total += curE - curS; curS = s; curE = e; }
    else if (e > curE) curE = e;
  }
  total += Math.max(0, curE - curS);
  return Math.round(total / 60000);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const RESEND = Deno.env.get("RESEND_API_KEY");
    if (!RESEND) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY not configured" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const json = await req.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "invalid_body", details: parsed.error.flatten().fieldErrors }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { shift, testRecipient } = parsed.data;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Auth: allow cron with service-role bearer, or authenticated admin/manager.
    const authHeader = req.headers.get("Authorization") ?? "";
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const isService = bearer && bearer === serviceKey;
    if (!isService) {
      if (!bearer) {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const authClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data: claimsData, error: claimsErr } = await authClient.auth.getClaims(bearer);
      if (claimsErr || !claimsData?.claims?.sub) {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: roles } = await supabase
        .from("user_roles").select("role").eq("user_id", claimsData.claims.sub);
      const allowed = (roles ?? []).some((r: any) => ["admin", "manager"].includes(r.role));
      if (!allowed) {
        return new Response(JSON.stringify({ error: "forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }


    // Pick the date: if cron runs at end of shift, the just-ended shift is for "today" London date.
    // For night shift triggered at 06:00, the night belongs to the PREVIOUS London day.
    const nowLondonISO = londonTodayISO();
    let dateISO = parsed.data.dateISO || nowLondonISO;
    if (!parsed.data.dateISO && shift === "night") {
      const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false }).format(new Date()));
      if (hour < 12) {
        const d = new Date(dateISO + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - 1);
        dateISO = d.toISOString().slice(0, 10);
      }
    }

    const { start, end, label } = shiftWindow(shift, dateISO);
    const startISO = start.toISOString();
    const endISO = end.toISOString();
    const wStart = start.getTime();
    const wEnd = end.getTime();

    /* ---------- Resolve recipients ---------- */
    let recipients: string[] = [];
    if (testRecipient) {
      recipients = [testRecipient];
    } else {
      const { data: settings } = await supabase
        .from("shift_report_settings")
        .select("day_enabled,night_enabled,extra_recipients,include_admins_managers")
        .limit(1).maybeSingle();
      const enabled = shift === "day" ? settings?.day_enabled : settings?.night_enabled;
      if (!enabled) {
        return new Response(JSON.stringify({ skipped: true, reason: "shift_disabled" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const extras = (settings?.extra_recipients || []).filter((e: string) => /.+@.+\..+/.test(e));
      recipients.push(...extras);
      if (settings?.include_admins_managers !== false) {
        const { data: roles } = await supabase
          .from("user_roles").select("user_id,role")
          .in("role", ["admin", "manager"]);
        const ids = (roles || []).map((r: any) => r.user_id);
        if (ids.length) {
          const { data: profs } = await supabase
            .from("profiles").select("email").in("id", ids);
          (profs || []).forEach((p: any) => { if (p.email) recipients.push(p.email); });
        }
      }
      recipients = Array.from(new Set(recipients.map((e) => e.trim().toLowerCase()))).filter(Boolean);
      if (!recipients.length) {
        return new Response(JSON.stringify({ skipped: true, reason: "no_recipients" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    /* ---------- Data: WOs created in window ---------- */
    const { data: wos } = await supabase
      .from("work_orders")
      .select("id,wo_number,machine,description,status,priority,created_at,received_at,started_at,finished_at,line_at_time")
      .gte("created_at", startISO).lt("created_at", endISO);
    const list = wos || [];
    const opened = list.length;
    const closed = list.filter((w: any) => ["finished", "closed", "completed", "force_closed"].includes(String(w.status))).length;

    // MTTR (started+finished in window)
    const finished = list.filter((w: any) => w.started_at && w.finished_at);
    const mttr = finished.length
      ? finished.reduce((s: number, w: any) => s + (new Date(w.finished_at).getTime() - new Date(w.started_at).getTime()) / 60000, 0) / finished.length
      : 0;

    // SLA compliance
    const slaTargets: Record<string, number> = { critical: 10, high: 30, medium: 60, low: 120 };
    const respList = list.filter((w: any) => w.received_at);
    const within = respList.filter((w: any) => {
      const t = slaTargets[w.priority || "medium"] || 60;
      return (new Date(w.received_at).getTime() - new Date(w.created_at).getTime()) / 60000 <= t;
    }).length;
    const slaPct = respList.length ? Math.round((within / respList.length) * 100) : 100;

    /* ---------- Downtime in window ---------- */
    const [dtEv, dtManual] = await Promise.all([
      supabase.from("downtime_events")
        .select("stopped_at,resumed_at,work_order:work_orders(machine,line_at_time,line:lines!work_orders_line_id_fkey(name))")
        .lt("stopped_at", endISO).or(`resumed_at.gte.${startISO},resumed_at.is.null`),
      supabase.from("downtime")
        .select("started_at,ended_at,line,machine")
        .lt("started_at", endISO).or(`ended_at.gte.${startISO},ended_at.is.null`),
    ]);

    type Rec = { start: string; end: string | null; line: string; machine: string };
    const recs: Rec[] = [];
    (dtEv.data || []).forEach((e: any) => {
      const line = e.work_order?.line?.name || e.work_order?.line_at_time || "—";
      recs.push({ start: e.stopped_at, end: e.resumed_at, line, machine: e.work_order?.machine || "—" });
    });
    (dtManual.data || []).forEach((r: any) => {
      recs.push({ start: r.started_at, end: r.ended_at, line: r.line || "—", machine: r.machine || "—" });
    });

    const totalDowntimeMin = reconcileMinutes(recs.map(r => ({ start: r.start, end: r.end })), wStart, wEnd);

    // Downtime per line (overlap minutes — not reconciled across lines but each line reconciled internally)
    const byLineMap = new Map<string, Rec[]>();
    recs.forEach((r) => {
      const arr = byLineMap.get(r.line) || [];
      arr.push(r); byLineMap.set(r.line, arr);
    });
    const byLine = Array.from(byLineMap.entries())
      .map(([line, arr]) => ({ line, mins: reconcileMinutes(arr, wStart, wEnd) }))
      .filter((x) => x.mins > 0)
      .sort((a, b) => b.mins - a.mins);

    // Top problems
    const problemMap: Record<string, number> = {};
    list.forEach((w: any) => {
      const k = (w.description || "Unspecified").toString().slice(0, 80);
      problemMap[k] = (problemMap[k] || 0) + 1;
    });
    const topProblems = Object.entries(problemMap).sort((a, b) => b[1] - a[1]).slice(0, 5);

    // Top machines
    const machMap: Record<string, number> = {};
    list.forEach((w: any) => { if (w.machine) machMap[w.machine] = (machMap[w.machine] || 0) + 1; });
    const topMachines = Object.entries(machMap).sort((a, b) => b[1] - a[1]).slice(0, 5);

    /* ---------- Build HTML ---------- */
    const fmtDate = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
    const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f7f8fa;padding:24px;color:#0f172a;margin:0">
  <div style="max-width:680px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
    <div style="background:#1978E5;color:#fff;padding:20px 24px">
      <h1 style="margin:0;font-size:20px">Shift Maintenance Report</h1>
      <p style="margin:4px 0 0;opacity:.9;font-size:13px">${label} — ${fmtDate(start)} → ${fmtDate(end)}</p>
    </div>
    <div style="padding:20px 24px">
      <table width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:18px">
        <tr>
          <td style="padding:10px;background:#f1f5f9;border-radius:8px;text-align:center"><div style="font-size:22px;font-weight:700">${opened}</div><div style="font-size:11px;color:#64748b">WOs Opened</div></td>
          <td width="6"></td>
          <td style="padding:10px;background:#f1f5f9;border-radius:8px;text-align:center"><div style="font-size:22px;font-weight:700">${closed}</div><div style="font-size:11px;color:#64748b">WOs Closed</div></td>
          <td width="6"></td>
          <td style="padding:10px;background:#f1f5f9;border-radius:8px;text-align:center"><div style="font-size:22px;font-weight:700">${fmtMin(mttr)}</div><div style="font-size:11px;color:#64748b">Avg MTTR</div></td>
          <td width="6"></td>
          <td style="padding:10px;background:#f1f5f9;border-radius:8px;text-align:center"><div style="font-size:22px;font-weight:700">${slaPct}%</div><div style="font-size:11px;color:#64748b">SLA</div></td>
          <td width="6"></td>
          <td style="padding:10px;background:#fef3c7;border-radius:8px;text-align:center"><div style="font-size:22px;font-weight:700">${fmtMin(totalDowntimeMin)}</div><div style="font-size:11px;color:#92400e">Line Downtime</div></td>
        </tr>
      </table>

      <h2 style="font-size:14px;margin:18px 0 8px">Downtime per Line</h2>
      ${byLine.length ? `<table width="100%" style="border-collapse:collapse;font-size:13px">
        <thead><tr><th align="left" style="padding:6px 8px;border-bottom:2px solid #cbd5e1">Line</th><th align="right" style="padding:6px 8px;border-bottom:2px solid #cbd5e1">Stopped</th></tr></thead>
        ${byLine.map((l) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0">${escHtml(l.line)}</td><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right"><b>${fmtMin(l.mins)}</b></td></tr>`).join("")}
      </table>` : `<p style="color:#64748b;font-size:13px">No line stoppages recorded.</p>`}

      <h2 style="font-size:14px;margin:18px 0 8px">Top Recurring Problems</h2>
      ${topProblems.length ? `<table width="100%" style="border-collapse:collapse;font-size:13px">
        ${topProblems.map(([p, c]) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0">${escHtml(p)}</td><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right"><b>${c}x</b></td></tr>`).join("")}
      </table>` : `<p style="color:#64748b;font-size:13px">No problems reported.</p>`}

      <h2 style="font-size:14px;margin:18px 0 8px">Top Machines (by WO count)</h2>
      ${topMachines.length ? `<table width="100%" style="border-collapse:collapse;font-size:13px">
        ${topMachines.map(([m, c]) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0">${escHtml(m)}</td><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right"><b>${c}</b></td></tr>`).join("")}
      </table>` : `<p style="color:#64748b;font-size:13px">No machine activity.</p>`}
    </div>
    <div style="background:#f8fafc;padding:14px 24px;font-size:11px;color:#64748b;text-align:center">
      Automated shift report from AN Maintenance.
    </div>
  </div>
</body></html>`;

    const subject = `Shift Report — ${label.split(" ")[0]} ${dateISO}`;
    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND}` },
      body: JSON.stringify({
        from: "AN Maintenance <onboarding@resend.dev>",
        to: recipients,
        subject,
        html,
      }),
    });
    const resendBody = await resendRes.text();
    if (!resendRes.ok) {
      return new Response(JSON.stringify({ error: "resend_failed", status: resendRes.status, body: resendBody.slice(0, 500) }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!testRecipient) {
      const col = shift === "day" ? "last_sent_day_at" : "last_sent_night_at";
      await supabase.from("shift_report_settings").update({ [col]: new Date().toISOString() }).gt("updated_at", "1970-01-01");
    }

    return new Response(JSON.stringify({
      success: true, shift, dateISO, recipients_count: recipients.length,
      opened, closed, mttr_minutes: Math.round(mttr), sla_percent: slaPct, downtime_minutes: totalDowntimeMin,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
