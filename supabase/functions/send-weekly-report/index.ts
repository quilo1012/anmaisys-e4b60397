import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";

const BodySchema = z.object({
  recipient: z.string().email().max(255),
});

function fmtMin(m: number) {
  if (!Number.isFinite(m) || m <= 0) return "—";
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const RESEND = Deno.env.get("RESEND_API_KEY");
    if (!RESEND) {
      return new Response(
        JSON.stringify({ error: "RESEND_API_KEY secret is not configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Require authenticated admin/manager caller.
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: claimsData, error: claimsErr } = await authClient.auth.getClaims(authHeader.replace("Bearer ", ""));
    if (claimsErr || !claimsData?.claims?.sub) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: roles } = await supabase
      .from("user_roles").select("role").eq("user_id", claimsData.claims.sub);
    const allowed = (roles ?? []).some((r: any) => ["admin", "manager"].includes(r.role));
    if (!allowed) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const json = await req.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: "invalid_body", details: parsed.error.flatten().fieldErrors }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const { recipient } = parsed.data;




    const since = new Date(Date.now() - 7 * 86400000).toISOString();

    const { data: wos } = await supabase
      .from("work_orders")
      .select("id,wo_number,machine,description,status,priority,created_at,started_at,finished_at")
      .gte("created_at", since);

    const list = wos || [];
    const opened = list.length;
    const closed = list.filter((w) => ["finished", "closed", "completed", "force_closed"].includes(String(w.status))).length;

    const finished = list.filter((w) => w.started_at && w.finished_at);
    const mttr = finished.length
      ? finished.reduce((s, w) => s + (new Date(w.finished_at!).getTime() - new Date(w.started_at!).getTime()) / 60000, 0) / finished.length
      : 0;

    const byMachine: Record<string, number> = {};
    list.forEach((w) => { if (w.machine) byMachine[w.machine] = (byMachine[w.machine] || 0) + 1; });
    const topMachines = Object.entries(byMachine)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const { data: pms } = await supabase
      .from("pm_schedules")
      .select("name,next_due_at,interval_days")
      .lte("next_due_at", new Date(Date.now() + 7 * 86400000).toISOString())
      .order("next_due_at", { ascending: true })
      .limit(10);

    const weekStart = new Date(since).toLocaleDateString("en-GB");
    const weekEnd = new Date().toLocaleDateString("en-GB");

    const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f7f8fa;padding:24px;color:#0f172a">
  <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
    <div style="background:#1978E5;color:#fff;padding:20px 24px">
      <h1 style="margin:0;font-size:20px">Weekly Maintenance Report</h1>
      <p style="margin:4px 0 0;opacity:.9;font-size:13px">${weekStart} — ${weekEnd}</p>
    </div>
    <div style="padding:20px 24px">
      <table width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:16px">
        <tr>
          <td style="padding:10px;background:#f1f5f9;border-radius:8px;text-align:center"><div style="font-size:22px;font-weight:700">${opened}</div><div style="font-size:11px;color:#64748b">WOs Opened</div></td>
          <td width="8"></td>
          <td style="padding:10px;background:#f1f5f9;border-radius:8px;text-align:center"><div style="font-size:22px;font-weight:700">${closed}</div><div style="font-size:11px;color:#64748b">WOs Closed</div></td>
          <td width="8"></td>
          <td style="padding:10px;background:#f1f5f9;border-radius:8px;text-align:center"><div style="font-size:22px;font-weight:700">${fmtMin(mttr)}</div><div style="font-size:11px;color:#64748b">Avg MTTR</div></td>
        </tr>
      </table>

      <h2 style="font-size:14px;margin:18px 0 8px">Top 5 Problem Machines</h2>
      ${topMachines.length ? `<table width="100%" style="border-collapse:collapse;font-size:13px">
        ${topMachines.map(([m, c]) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0">${m}</td><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right"><b>${c}</b></td></tr>`).join("")}
      </table>` : `<p style="color:#64748b;font-size:13px">No work orders recorded.</p>`}

      <h2 style="font-size:14px;margin:18px 0 8px">Preventive Maintenance Due (next 7 days)</h2>
      ${(pms && pms.length) ? `<table width="100%" style="border-collapse:collapse;font-size:13px">
        ${pms.map((p: any) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0">${p.name}</td><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;color:#b45309">${new Date(p.next_due_at).toLocaleDateString("en-GB")}</td></tr>`).join("")}
      </table>` : `<p style="color:#64748b;font-size:13px">No PMs due this week.</p>`}
    </div>
    <div style="background:#f8fafc;padding:14px 24px;font-size:11px;color:#64748b;text-align:center">
      Automated report from AN Maintenance.
    </div>
  </div>
</body></html>`;

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND}`,
      },
      body: JSON.stringify({
        from: "AN Maintenance <onboarding@resend.dev>",
        to: [recipient],
        subject: `Weekly Maintenance Report — ${weekEnd}`,
        html,
      }),
    });
    const resendBody = await resendRes.text();
    if (!resendRes.ok) {
      return new Response(
        JSON.stringify({ error: "resend_failed", status: resendRes.status, body: resendBody.slice(0, 500) }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Best-effort Teams summary (ignore failures)
    const teamsWebhook = Deno.env.get("TEAMS_WEBHOOK_URL");
    if (teamsWebhook) {
      await fetch(teamsWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "message",
          attachments: [{
            contentType: "application/vnd.microsoft.card.adaptive",
            content: {
              $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
              type: "AdaptiveCard",
              version: "1.4",
              body: [
                { type: "TextBlock", size: "Large", weight: "Bolder", text: "📊 Weekly Maintenance Report" },
                { type: "TextBlock", text: `${weekStart} — ${weekEnd}`, isSubtle: true, spacing: "None" },
                { type: "FactSet", facts: [
                  { title: "WOs Opened", value: String(opened) },
                  { title: "WOs Closed", value: String(closed) },
                  { title: "Avg MTTR", value: fmtMin(mttr) },
                ]},
              ],
            },
          }],
        }),
      }).catch(() => null);
    }

    return new Response(JSON.stringify({ success: true, opened, closed, mttr_minutes: Math.round(mttr) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
