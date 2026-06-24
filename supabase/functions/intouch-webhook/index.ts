// Intouch i4 webhook receiver.
// Logs every incoming payload (raw) so the real format can be inspected on the
// first call from the device. If the payload can be mapped to a known shape,
// creates a downtime_event + work_order automatically.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const headersObj: Record<string, string> = {};
  req.headers.forEach((v, k) => { headersObj[k] = v; });

  // Read body as text first so we can still log if JSON parse fails.
  const raw = await req.text();
  let payload: any = null;
  let parseError: string | null = null;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch (e) {
    parseError = `invalid_json: ${(e as Error).message}`;
    payload = { _raw: raw };
  }

  // Optional shared-secret check via header.
  const sig = headersObj["x-intouch-signature"] ?? headersObj["x-webhook-secret"] ?? "";
  const authOk = !WEBHOOK_SECRET || sig === WEBHOOK_SECRET;

  let createdWoId: string | null = null;
  let errorMessage: string | null = parseError;
  let parsedOk = false;

  if (authOk && !parseError) {
    try {
      // Try to extract fields from common Intouch payload shapes.
      const stopCode = String(pick(payload, ["stop_code", "stopCode", "code", "reason_code"]) ?? "").trim();
      const lineName = pick(payload, ["line", "line_name", "lineName", "production_line"]);
      const machineName = pick(payload, ["machine", "machine_name", "asset", "equipment"]);
      const description = pick(payload, ["description", "reason", "message", "comment"]);
      const eventType = String(pick(payload, ["event", "event_type", "type", "status"]) ?? "").toLowerCase();

      // Stop-code lookup (optional).
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

      // Resolve line_id when a line name is provided.
      let lineId: string | null = null;
      if (lineName || mapped?.line_hint) {
        const lookupName = String(lineName ?? mapped?.line_hint);
        const { data: line } = await admin
          .from("lines")
          .select("id")
          .ilike("name", lookupName)
          .maybeSingle();
        lineId = line?.id ?? null;
      }

      // Only create a WO on "stop"/"down" events.
      const isStop = !eventType
        || ["stop", "stopped", "down", "downtime", "alarm", "fault"].includes(eventType);

      if (isStop) {
        const label = mapped?.label ?? description ?? stopCode ?? "Intouch i4 alert";
        const priority = (mapped?.default_priority ?? "medium") as string;

        const { data: wo, error: woErr } = await admin
          .from("work_orders")
          .insert({
            requester_name: "Intouch i4",
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
          stopped_by_name: "Intouch i4",
        });
      }

      parsedOk = true;
    } catch (e) {
      errorMessage = (e as Error).message;
    }
  } else if (!authOk) {
    errorMessage = "invalid_signature";
  }

  // Always log.
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
    JSON.stringify({ ok: parsedOk, wo_id: createdWoId, error: errorMessage }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" }, status },
  );
});
