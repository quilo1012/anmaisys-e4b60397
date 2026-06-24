// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const supabase = createClient(url, serviceKey);

    // Require authenticated admin/manager caller.
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const authClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claimsData, error: claimsErr } = await authClient.auth.getClaims(authHeader.slice(7));
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


    const body = await req.json().catch(() => ({}));
    const recipient: string | undefined = body?.to;

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: wos, error } = await supabase
      .from("work_orders")
      .select("wo_number, created_at, machine, line_at_time, priority, status, requester_name, engineer_name, received_at, started_at, finished_at, closed_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false });
    if (error) throw error;

    const { data: parts } = await supabase
      .from("parts_used")
      .select("work_order_id, quantity, product:products(name)")
      .gte("created_at", since);

    const partsByWo: Record<string, string[]> = {};
    for (const p of (parts ?? []) as any[]) {
      const arr = (partsByWo[p.work_order_id] ??= []);
      arr.push(`${(p.product as any)?.name ?? "?"} x${p.quantity}`);
    }

    const headers = ["WO#","Created","Machine","Line","Priority","Status","Requester","Engineer","Response (min)","Repair (min)","Total (min)","Parts"];
    const rows = (wos ?? []).map((w: any) => {
      const yr = new Date(w.created_at).getFullYear();
      const num = w.wo_number ? `WO-${yr}-${String(w.wo_number).padStart(6,"0")}` : "";
      const resp = w.received_at ? Math.round((new Date(w.received_at).getTime() - new Date(w.created_at).getTime())/60000) : "";
      const repair = w.started_at && w.finished_at ? Math.round((new Date(w.finished_at).getTime() - new Date(w.started_at).getTime())/60000) : "";
      const total = w.finished_at ? Math.round((new Date(w.finished_at).getTime() - new Date(w.created_at).getTime())/60000) : "";
      const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g,'""')}"`;
      return [num, w.created_at, w.machine, w.line_at_time, w.priority, w.status, w.requester_name, w.engineer_name, resp, repair, total, (partsByWo[w.id] ?? []).join("; ")]
        .map(escape).join(",");
    });
    const csv = [headers.join(","), ...rows].join("\n");
    const csvB64 = btoa(unescape(encodeURIComponent(csv)));

    const totals = {
      count: wos?.length ?? 0,
      open: (wos ?? []).filter((w: any) => !["finished","closed","completed","force_closed"].includes(w.status)).length,
      finished: (wos ?? []).filter((w: any) => w.status === "finished").length,
    };

    if (recipient && resendKey) {
      const html = `<h2>Weekly Maintenance Report</h2>
        <p>Period: last 7 days</p>
        <ul>
          <li>Total work orders: <b>${totals.count}</b></li>
          <li>Still open: <b>${totals.open}</b></li>
          <li>Finished: <b>${totals.finished}</b></li>
        </ul>
        <p>Full CSV attached.</p>`;
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Maintenance <onboarding@resend.dev>",
          to: [recipient],
          subject: `Weekly Maintenance Report — ${totals.count} WO`,
          html,
          attachments: [{ filename: `weekly-${new Date().toISOString().slice(0,10)}.csv`, content: csvB64 }],
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        return new Response(JSON.stringify({ error: `resend_failed: ${t}` }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    return new Response(JSON.stringify({ success: true, totals, csv_size: csv.length, emailed: Boolean(recipient && resendKey) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
