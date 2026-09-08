import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";

const BodySchema = z.object({
  recipient: z.string().email().max(255),
  date: z.string().optional(), // YYYY-MM-DD; defaults to today London
});

function escHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function londonToday(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });
  return fmt.format(new Date());
}

function ragColor(plan: number, actual: number): { label: string; bg: string } {
  if (plan <= 0) return { label: "—", bg: "#64748b" };
  const pct = actual / plan;
  if (actual >= plan) return { label: "GREEN", bg: "#16a34a" };
  if (pct >= 0.9) return { label: "AMBER", bg: "#f59e0b" };
  return { label: "RED", bg: "#dc2626" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const RESEND = Deno.env.get("RESEND_API_KEY");
    if (!RESEND) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY secret is not configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const authClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: claimsData, error: claimsErr } = await authClient.auth.getClaims(authHeader.replace("Bearer ", ""));
    if (claimsErr || !claimsData?.claims?.sub) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", claimsData.claims.sub);
    const allowed = (roles ?? []).some((r: any) => ["admin", "manager"].includes(r.role));
    if (!allowed) {
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const json = await req.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "invalid_body", details: parsed.error.flatten().fieldErrors }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { recipient } = parsed.data;
    const day = parsed.data.date ?? londonToday();

    const { data: entries } = await supabase
      .from("rag_weekly_entries")
      .select("line,shift,plan_qty,actual_qty,downtime_min")
      .eq("entry_date", day)
      .order("line", { ascending: true });

    const rows = entries ?? [];
    const totalPlan = rows.reduce((s, r: any) => s + Number(r.plan_qty || 0), 0);
    const totalActual = rows.reduce((s, r: any) => s + Number(r.actual_qty || 0), 0);
    const totalDown = rows.reduce((s, r: any) => s + Number(r.downtime_min || 0), 0);
    const overall = ragColor(totalPlan, totalActual);

    const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f7f8fa;padding:24px;color:#0f172a">
  <div style="max-width:680px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
    <div style="background:#1978E5;color:#fff;padding:20px 24px">
      <h1 style="margin:0;font-size:20px">Daily RAG Report</h1>
      <p style="margin:4px 0 0;opacity:.9;font-size:13px">${escHtml(day)} — London time</p>
    </div>
    <div style="padding:20px 24px">
      <table width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:16px">
        <tr>
          <td style="padding:10px;background:#f1f5f9;border-radius:8px;text-align:center"><div style="font-size:22px;font-weight:700">${totalPlan}</div><div style="font-size:11px;color:#64748b">Plan</div></td>
          <td width="8"></td>
          <td style="padding:10px;background:#f1f5f9;border-radius:8px;text-align:center"><div style="font-size:22px;font-weight:700">${totalActual}</div><div style="font-size:11px;color:#64748b">Actual</div></td>
          <td width="8"></td>
          <td style="padding:10px;background:#f1f5f9;border-radius:8px;text-align:center"><div style="font-size:22px;font-weight:700">${Math.round(totalDown)}m</div><div style="font-size:11px;color:#64748b">Downtime</div></td>
          <td width="8"></td>
          <td style="padding:10px;background:${overall.bg};color:#fff;border-radius:8px;text-align:center"><div style="font-size:22px;font-weight:700">${overall.label}</div><div style="font-size:11px;opacity:.85">Overall</div></td>
        </tr>
      </table>

      <h2 style="font-size:14px;margin:18px 0 8px">Per Line / Shift</h2>
      ${rows.length ? `<table width="100%" style="border-collapse:collapse;font-size:13px">
        <tr style="background:#f8fafc"><th style="text-align:left;padding:6px 8px">Line</th><th style="text-align:left;padding:6px 8px">Shift</th><th style="text-align:right;padding:6px 8px">Plan</th><th style="text-align:right;padding:6px 8px">Actual</th><th style="text-align:right;padding:6px 8px">DT</th><th style="text-align:center;padding:6px 8px">RAG</th></tr>
        ${rows.map((r: any) => {
          const rag = ragColor(Number(r.plan_qty || 0), Number(r.actual_qty || 0));
          return `<tr><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0">${escHtml(r.line)}</td><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0">${escHtml(r.shift)}</td><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right">${Number(r.plan_qty || 0)}</td><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right"><b>${Number(r.actual_qty || 0)}</b></td><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right">${Math.round(Number(r.downtime_min || 0))}m</td><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:center"><span style="display:inline-block;padding:2px 8px;border-radius:10px;background:${rag.bg};color:#fff;font-size:11px;font-weight:600">${rag.label}</span></td></tr>`;
        }).join("")}
      </table>` : `<p style="color:#64748b;font-size:13px">No RAG entries for this day.</p>`}
    </div>
    <div style="background:#f8fafc;padding:14px 24px;font-size:11px;color:#64748b;text-align:center">Automated daily report from AN Maintenance.</div>
  </div>
</body></html>`;

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND}` },
      body: JSON.stringify({
        from: "AN Maintenance <onboarding@resend.dev>",
        to: [recipient],
        subject: `Daily RAG Report — ${day}`,
        html,
      }),
    });
    const resendBody = await resendRes.text();
    if (!resendRes.ok) {
      return new Response(JSON.stringify({ error: "resend_failed", status: resendRes.status, body: resendBody.slice(0, 500) }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ success: true, date: day, plan: totalPlan, actual: totalActual, downtime_min: Math.round(totalDown), rag: overall.label }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
