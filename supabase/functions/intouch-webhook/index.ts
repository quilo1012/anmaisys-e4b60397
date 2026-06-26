// Intouch i4 webhook receiver.
// Logs every incoming payload (raw) so the real format can be inspected on the
// first call from the device. Operational stops (requires_wo = false) skip WO
// creation and instead trigger PM opportunity notifications when there are
// pending preventive-maintenance tasks for the affected machine/line.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("INTOUCH_WEBHOOK_SECRET") ?? "";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

function pick(obj: any, keys: string[]): any {
  if (!obj || typeof obj !== "object") return undefined;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
    const lower = k.toLowerCase();
    for (const oKey of Object.keys(obj)) {
      if (oKey.toLowerCase() === lower && obj[oKey] !== undefined && obj[oKey] !== null && obj[oKey] !== "") {
        return obj[oKey];
      }
    }
  }
  return undefined;
}

async function notifyPmOpportunity(opts: {
  machineName: string | null;
  lineName: string | null;
  stopLabel: string;
}) {
  const { machineName, lineName, stopLabel } = opts;
  if (!machineName && !lineName) return { sent: false, reason: "no_target" };

  // Find PM schedules due in the next 7 days for this machine (or any machine
  // on this line when only the line name is available).
  const horizon = new Date(Date.now() + 7 * 86_400_000).toISOString();
  let query = admin
    .from("pm_schedules")
    .select("id, machine, title, next_due_at, priority")
    .eq("active", true)
    .lte("next_due_at", horizon);

  if (machineName) query = query.eq("machine", machineName);

  const { data: schedules, error } = await query;
  if (error) throw error;
  const pending = schedules ?? [];
  if (!pending.length) return { sent: false, reason: "no_pending_pm" };

  const now = Date.now();
  const overdue = pending.filter((s) => new Date(s.next_due_at!).getTime() < now);
  const upcoming = pending.filter((s) => new Date(s.next_due_at!).getTime() >= now);

  // Build push payload
  const target = machineName ?? lineName ?? "Machine";
  const title = `🔧 PM Opportunity — ${target}`;
  const bodyLines: string[] = [
    `${stopLabel}. ${pending.length} PM task${pending.length > 1 ? "s" : ""} can be done now.`,
  ];
  for (const s of overdue.slice(0, 3)) bodyLines.push(`⚠️ OVERDUE: ${s.title}`);
  for (const s of upcoming.slice(0, 3)) {
    const d = new Date(s.next_due_at!);
    bodyLines.push(`📅 Due ${d.getUTCDate().toString().padStart(2, "0")}/${(d.getUTCMonth() + 1).toString().padStart(2, "0")}: ${s.title}`);
  }
  const priority = overdue.length > 0 ? "high" : "medium";

  // Engineer user IDs
  const { data: engRoles } = await admin
    .from("user_roles").select("user_id").eq("role", "engineer");
  const userIds = (engRoles ?? []).map((r: any) => r.user_id);

  if (userIds.length) {
    await admin.from("notifications").insert(
      userIds.map((uid: string) => ({
        user_id: uid,
        title,
        body: bodyLines.join("\n"),
        priority,
        action_url: "/dashboard/preventive",
      })),
    );
  }

  // Teams card (best-effort)
  const teamsUrl = Deno.env.get("TEAMS_WEBHOOK_URL");
  if (teamsUrl) {
    try {
      await fetch(teamsUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          "@type": "MessageCard",
          "@context": "https://schema.org/extensions",
          themeColor: overdue.length ? "FFA500" : "1978E5",
          summary: title,
          title,
          text: bodyLines.join("  \n"),
          potentialAction: [{
            "@type": "OpenUri",
            name: "Open Preventive Maintenance",
            targets: [{ os: "default", uri: `${SUPABASE_URL.replace(/\.supabase\.co.*$/, "")}/dashboard/preventive` }],
          }],
        }),
      });
    } catch (err) {
      console.error("[intouch-webhook] failed to send Teams preventive-maintenance card", {
        error: (err as Error)?.message ?? String(err),
      });
    }
  }

  return { sent: true, total: pending.length, overdue: overdue.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const headersObj: Record<string, string> = {};
  req.headers.forEach((v, k) => { headersObj[k] = v; });

  const raw = await req.text();
  let payload: any = null;
  let parseError: string | null = null;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch (e) {
    parseError = `invalid_json: ${(e as Error).message}`;
    payload = { _raw: raw };
  }

  const sig = headersObj["x-intouch-signature"] ?? headersObj["x-webhook-secret"] ?? "";
  const authOk = Boolean(WEBHOOK_SECRET) && sig === WEBHOOK_SECRET;

  let createdWoId: string | null = null;
  let errorMessage: string | null = parseError;
  let parsedOk = false;
  let pmInfo: any = null;

  if (authOk && !parseError) {
    try {
      const stopCode = String(pick(payload, ["stop_code", "stopCode", "code", "reason_code"]) ?? "").trim();
      const lineName = pick(payload, ["line", "line_name", "lineName", "production_line"]);
      const machineName = pick(payload, ["machine", "machine_name", "asset", "equipment"]);
      const description = pick(payload, ["description", "reason", "message", "comment"]);
      const eventType = String(pick(payload, ["event", "event_type", "type", "status"]) ?? "").toLowerCase();

      let mapped: any = null;
      if (stopCode) {
        const { data } = await admin
          .from("intouch_stop_code_map")
          .select("*")
          .eq("stop_code", stopCode)
          .eq("active", true)
          .maybeSingle();
        mapped = data;
      }

      let lineId: string | null = null;
      if (lineName || mapped?.line_hint) {
        const lookupName = String(lineName ?? mapped?.line_hint);
        const { data: line } = await admin
          .from("lines").select("id").ilike("name", lookupName).maybeSingle();
        lineId = line?.id ?? null;
      }

      const isStop = !eventType
        || ["stop", "stopped", "down", "downtime", "alarm", "fault"].includes(eventType);

      // Operational stops (requires_wo=false) → PM opportunity path, no WO.
      const requiresWo = mapped ? mapped.requires_wo !== false : true;

      if (isStop && !requiresWo) {
        const stopLabel = mapped?.label ?? description ?? stopCode ?? "Operational stop";
        pmInfo = await notifyPmOpportunity({
          machineName: machineName ?? null,
          lineName: lineName ?? mapped?.line_hint ?? null,
          stopLabel: String(stopLabel),
        });
      } else if (isStop) {
        const label = mapped?.label ?? description ?? stopCode ?? "Intouch i4 alert";
        const priority = (mapped?.default_priority ?? "medium") as string;

        // Resolve current Line Leader (by line + current London shift) for requester_name
        const resolvedLineName = lineName ?? mapped?.line_hint ?? null;
        let requesterName = "Intouch i4";
        if (resolvedLineName) {
          const londonHour = Number(
            new Date().toLocaleString("en-GB", {
              timeZone: "Europe/London", hour12: false, hour: "2-digit",
            }).slice(0, 2)
          );
          const shift = londonHour >= 6 && londonHour < 18 ? "DAY" : "NIGHT";
          const { data: leader } = await admin
            .from("line_leaders")
            .select("name")
            .ilike("line", String(resolvedLineName))
            .eq("shift", shift)
            .eq("active", true)
            .maybeSingle();
          if (leader?.name) requesterName = `${leader.name} (${resolvedLineName})`;
          else requesterName = `${resolvedLineName} Leader`;
        }

        const { data: wo, error: woErr } = await admin
          .from("work_orders")
          .insert({
            requester_name: requesterName,
            machine: machineName ?? null,
            line_id: lineId,
            description: String(label),
            priority,
            status: "open",
            notes: `[Auto-created from Intouch i4]\nStop code: ${stopCode || "n/a"}\nLine: ${lineName ?? "n/a"}\nMachine: ${machineName ?? "n/a"}`,
            line_stopped: true,
            line_stopped_at: new Date().toISOString(),
          })
          .select("id")
          .single();

        if (woErr) throw woErr;
        createdWoId = wo.id;

        await admin.from("downtime_events").insert({
          work_order_id: wo.id,
          stopped_at: new Date().toISOString(),
          stopped_reason: String(label),
          stopped_by_name: requesterName,
        });

        // Notify all engineers (in-app bell + push handled by their subscriptions)
        try {
          const { data: engRoles } = await admin
            .from("user_roles").select("user_id").eq("role", "engineer");
          const userIds = (engRoles ?? []).map((r: any) => r.user_id);
          if (userIds.length) {
            const title = `🚨 New WO — ${machineName ?? resolvedLineName ?? "Line"}`;
            const body = `${label}${resolvedLineName ? `\nLine: ${resolvedLineName}` : ""}\nAuto-created from iTouching`;
            await admin.from("notifications").insert(
              userIds.map((uid: string) => ({
                user_id: uid,
                wo_id: wo.id,
                title,
                body,
                priority: priority === "critical" ? "high" : priority,
                action_url: `/dashboard/work-orders/${wo.id}`,
              })),
            );
          }
        } catch (err) {
          console.error("[intouch-webhook] best-effort engineer notification failed", {
            wo_id: wo?.id,
            wo_number: wo?.wo_number,
            error: (err as Error)?.message ?? String(err),
          });
        }
      }



      parsedOk = true;
    } catch (e) {
      errorMessage = (e as Error).message;
    }
  } else if (!authOk) {
    errorMessage = "invalid_signature";
  }

  await admin.from("intouch_webhook_logs").insert({
    source_ip: headersObj["x-forwarded-for"] ?? headersObj["cf-connecting-ip"] ?? null,
    headers: headersObj,
    payload,
    parsed_ok: parsedOk,
    error_message: errorMessage,
    created_wo_id: createdWoId,
  });

  const status = !authOk ? 401 : parsedOk ? 200 : 202;
  return new Response(
    JSON.stringify({ ok: parsedOk, wo_id: createdWoId, pm: pmInfo, error: errorMessage }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" }, status },
  );
});
