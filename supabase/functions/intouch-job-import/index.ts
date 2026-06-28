// POST production items to iTouching as scheduled jobs (/api/JobImport).
// Input: { session_date, shift, line, items: [{code, description, qty}] }
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "https://esm.sh/zod@3.23.8";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTOUCH_URL = (Deno.env.get("INTOUCH_API_URL") ?? "").replace(/\/+$/, "");
const INTOUCH_TOKEN = Deno.env.get("INTOUCH_API_TOKEN") ?? "";
const TIMEOUT_MS = 15_000;

const Body = z.object({
  session_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shift: z.enum(["DAY", "NIGHT"]),
  line: z.string().min(1),
  items: z.array(z.object({
    code: z.string().min(1),
    description: z.string().optional().default(""),
    qty: z.number().nonnegative(),
  })).min(1),
}).strict();

const authValue = INTOUCH_TOKEN.trim().match(/^bearer\s+/i)
  ? INTOUCH_TOKEN.trim() : `Bearer ${INTOUCH_TOKEN.trim()}`;

function londonOffsetMs(d: Date) {
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(d).filter((x) => x.type !== "literal").map((x) => [x.type, x.value])) as Record<string, string>;
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - d.getTime();
}
function shiftWindow(date: string, shift: "DAY" | "NIGHT") {
  const h = shift === "DAY" ? 6 : 18;
  const naive = new Date(`${date}T${String(h).padStart(2, "0")}:00:00Z`);
  const start = new Date(naive.getTime() - londonOffsetMs(naive));
  const end = new Date(start.getTime() + 12 * 3600 * 1000);
  return { start, end };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "unauthorized" }, 401);
    const authClient = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
    const { data: claims, error: cErr } = await authClient.auth.getClaims(token);
    const uid = claims?.claims?.sub as string | undefined;
    if (cErr || !uid) return json({ error: "invalid_token" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", uid);
    if (!(roles ?? []).some((r) => ["admin", "manager"].includes(r.role))) {
      return json({ error: "forbidden" }, 403);
    }

    if (!INTOUCH_URL || !INTOUCH_TOKEN) return json({ error: "iTouching API not configured" }, 500);

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
    const { session_date, shift, line, items } = parsed.data;

    // Quota gate
    const { data: q } = await admin.from("intouch_quota_status")
      .select("blocked_until").eq("id", "singleton").maybeSingle();
    if (q?.blocked_until && new Date(q.blocked_until).getTime() > Date.now()) {
      return json({ error: "iTouching daily quota exhausted", retry_after: q.blocked_until }, 429);
    }

    // Resolve line -> intouch machine (use first active mapping for the line)
    const { data: lineRow } = await admin.from("lines").select("id").eq("name", line).maybeSingle();
    if (!lineRow?.id) return json({ error: `Line "${line}" not found` }, 400);
    const { data: maps } = await admin.from("intouch_machine_map")
      .select("intouch_machine_id, intouch_machine_name")
      .eq("line_id", lineRow.id).eq("active", true);
    if (!maps || maps.length === 0) {
      return json({ error: `No iTouching machine mapped for line "${line}"` }, 400);
    }
    const machineId = maps[0].intouch_machine_id;

    const { start, end } = shiftWindow(session_date, shift);
    const startISO = start.toISOString();
    const endISO = end.toISOString();

    const jobs = items.map((it, idx) => ({
      MachineID: machineId,
      MachineGUID: machineId,
      PartCode: it.code,
      ProductCode: it.code,
      Description: it.description || it.code,
      OrderQty: it.qty,
      JobOrderQuantity: it.qty,
      PlannedStart: startISO,
      PlannedFinish: endISO,
      EarliestStart: startISO,
      LatestFinish: endISO,
      Sequence: idx + 1,
      Shift: shift,
      Reference: `ANM-${session_date}-${shift}-${line}-${idx + 1}`,
    }));

    const payload = { Jobs: jobs };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let status = 0;
    let bodyText = "";
    try {
      const res = await fetch(`${INTOUCH_URL}/api/JobImport`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: authValue,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      status = res.status;
      bodyText = await res.text();
    } catch (e) {
      if ((e as any)?.name === "AbortError") return json({ error: "iTouching API timeout" }, 504);
      return json({ error: (e as Error).message }, 502);
    } finally {
      clearTimeout(timer);
    }

    if (bodyText.includes("Exceeded API Max daily egress")) {
      const tomorrow = new Date(); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1); tomorrow.setUTCHours(0, 0, 0, 0);
      await admin.from("intouch_quota_status").upsert({
        id: "singleton", blocked_until: tomorrow.toISOString(), updated_at: new Date().toISOString(),
      });
      return json({ error: "iTouching daily quota exhausted" }, 429);
    }

    if (status < 200 || status >= 300) {
      return json({ error: "iTouching JobImport failed", status, body: bodyText.slice(0, 800) }, 502);
    }

    let parsedBody: unknown = bodyText;
    try { parsedBody = JSON.parse(bodyText); } catch { /* keep as text */ }

    return json({ success: true, sent: jobs.length, machine_id: machineId, response: parsedBody });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
