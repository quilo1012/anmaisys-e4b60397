// Best-effort server-side audit logging for privileged edge functions.
// It NEVER throws — a failed audit insert must not break the operation it records,
// so every call site can `await writeAudit(...)` right before returning success
// without risking the main flow. Writes directly to public.audit_logs using the
// function's existing service-role client, so a direct API call (no browser) is
// still recorded — closing the client-side-only audit gap.

/* eslint-disable @typescript-eslint/no-explicit-any -- edge runtime, supabase client is loosely typed */

function extractIp(req?: Request): string | null {
  if (!req) return null;
  const xri = req.headers.get("x-real-ip");
  if (xri) return xri.trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  return null;
}

export async function writeAudit(
  svc: any,
  opts: {
    callerId?: string | null;
    callerName?: string | null;
    req?: Request;
    action: string;
    entity_type: string;
    entity_id?: string | null;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    let userName: string | null = opts.callerName ?? null;
    if (!userName && opts.callerId) {
      const { data: prof } = await svc
        .from("profiles")
        .select("name, email")
        .eq("id", opts.callerId)
        .maybeSingle();
      userName = (prof?.name as string) || (prof?.email as string) || null;
    }
    await svc.from("audit_logs").insert({
      user_id: opts.callerId ?? null,
      user_name: userName ?? "system",
      action: opts.action,
      entity_type: opts.entity_type,
      entity_id: opts.entity_id ?? null,
      details: opts.details ?? {},
      ip_address: extractIp(opts.req),
    });
  } catch (e) {
    console.error("audit write failed (non-fatal):", e);
  }
}
