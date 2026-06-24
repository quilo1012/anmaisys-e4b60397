// @ts-nocheck
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
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

    const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY");
    const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY");
    const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: roles } = await supabase
      .from("user_roles").select("role").eq("user_id", claimsData.claims.sub);
    const isStaff = (roles ?? []).some((r: any) => ["admin", "manager"].includes(r.role));

    const body = await req.json();
    const userIds: string[] = body.user_ids || (body.user_id ? [body.user_id] : []);
    if (!userIds.length) {
      return new Response(
        JSON.stringify({ error: "user_id or user_ids required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    // Non-staff callers may only target themselves.
    if (!isStaff && userIds.some((id) => id !== claimsData.claims.sub)) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );


    // Always write in-app notification (bell), even if push isn't configured
    const { error: notifErr } = await supabase.from("notifications").insert(
      userIds.map((uid) => ({
        user_id: uid,
        wo_id: body.wo_id ?? null,
        title: body.title,
        body: body.body ?? "",
        priority: body.priority || "medium",
        action_url: body.action_url ?? null,
      }))
    );
    if (notifErr) console.error("notifications insert error:", notifErr);

    // If VAPID isn't configured, skip web-push but report success for in-app delivery
    if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
      return new Response(
        JSON.stringify({ sent: 0, failed: 0, total: 0, in_app: userIds.length, note: "VAPID not configured" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

    const { data: subs, error } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth, user_id")
      .in("user_id", userIds);
    if (error) throw error;

    const payload = JSON.stringify({
      title: body.title,
      body: body.body,
      priority: body.priority || "medium",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: body.tag,
      requireInteraction: !!body.requireInteraction,
      data: { url: body.action_url || "/", wo_id: body.wo_id },
    });

    const results = await Promise.allSettled(
      (subs || []).map((sub) =>
        webpush
          .sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload
          )
          .catch(async (err: any) => {
            if (err.statusCode === 410 || err.statusCode === 404) {
              await supabase.from("push_subscriptions").delete().eq("id", sub.id);
            }
            throw err;
          })
      )
    );

    const ok = results.filter((r) => r.status === "fulfilled").length;
    const fail = results.length - ok;

    return new Response(
      JSON.stringify({ sent: ok, failed: fail, total: results.length, in_app: userIds.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("send-push error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
