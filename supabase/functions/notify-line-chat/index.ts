import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const BodySchema = z.object({
  line_id: z.string().uuid(),
  message_id: z.string().uuid().optional(),
}).strict();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
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
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await authClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims?.sub) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const senderId = claimsData.claims.sub as string;

    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten().fieldErrors }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { line_id, message_id } = parsed.data;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Load line + message
    const { data: line } = await admin.from("lines").select("id,name").eq("id", line_id).maybeSingle();
    if (!line) {
      return new Response(JSON.stringify({ error: "line not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let msg: { message: string; user_name: string; user_id: string; line_id: string } | null = null;
    if (message_id) {
      const { data } = await admin
        .from("line_chat_messages")
        .select("message,user_name,user_id,line_id")
        .eq("id", message_id)
        .maybeSingle();
      msg = data as any;
      // Ownership + line-scope check: caller must own the message and it must belong to the given line.
      if (msg && (msg.user_id !== senderId || msg.line_id !== line_id)) {
        return new Response(JSON.stringify({ error: "forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    if (!msg) {
      // fallback: latest message from sender in this line
      const { data } = await admin
        .from("line_chat_messages")
        .select("message,user_name,user_id,line_id")
        .eq("line_id", line_id)
        .eq("user_id", senderId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      msg = data as any;
    }

    if (!msg) {
      return new Response(JSON.stringify({ error: "message not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Recipients: operators assigned to this line + all admin/manager/maintenance_manager
    const recipients = new Set<string>();

    const { data: opAccounts } = await admin
      .from("operator_line_accounts")
      .select("user_id,line_ids");
    for (const row of (opAccounts ?? []) as Array<{ user_id: string; line_ids: string[] | null }>) {
      if ((row.line_ids ?? []).includes(line_id)) recipients.add(row.user_id);
    }

    const { data: staffRoles } = await admin
      .from("user_roles")
      .select("user_id,role")
      .in("role", ["admin", "manager", "maintenance_manager"]);
    for (const r of (staffRoles ?? []) as Array<{ user_id: string }>) recipients.add(r.user_id);

    recipients.delete(senderId);
    const userIds = [...recipients];

    if (!userIds.length) {
      return new Response(JSON.stringify({ sent: 0, total: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const title = `[${line.name}] ${msg.user_name}`;
    const bodyText = msg.message.length > 140 ? msg.message.slice(0, 137) + "…" : msg.message;

    // In-app notification bell
    await admin.from("notifications").insert(
      userIds.map((uid) => ({
        user_id: uid,
        title,
        body: bodyText,
        priority: "low",
        action_url: "/",
      })),
    );

    // Push
    const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY");
    const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY");
    const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";
    if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
      return new Response(JSON.stringify({ sent: 0, total: userIds.length, note: "VAPID not configured" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("id,endpoint,p256dh,auth,user_id")
      .in("user_id", userIds);

    // Per-line logo (falls back to favicon). Path is relative to app origin;
    // the SW resolves it against its own origin when displaying.
    const LINE_ICONS: Record<string, string> = {
      "line 1": "/__l5e/assets-v1/06127e1c-d58f-4b7e-a729-3a165f28a9dd/line1.png",
      "line 2": "/__l5e/assets-v1/408fe0b8-2aa1-4d3a-8513-6a4fb551eeb9/line2.png",
      "line 3": "/__l5e/assets-v1/f87924d7-cede-40a4-96ec-8456bb12d9cf/line3.png",
      "line 4": "/__l5e/assets-v1/bda8e82a-6bad-405a-bef0-929961018e4c/line4.png",
      "line 5": "/__l5e/assets-v1/1dbd0626-102b-4acf-af3e-e768a59568d1/line5.png",
      "line 6": "/__l5e/assets-v1/bac602da-335e-483a-b2f7-2b98389eeb98/line6.png",
      "tablet line": "/__l5e/assets-v1/7aef556e-9a8a-435e-a554-a90484b0e14e/tablet.png",
    };
    const key = (line.name ?? "").toLowerCase().trim();
    const icon = LINE_ICONS[key] || "/favicon.ico";

    const payload = JSON.stringify({
      title,
      body: bodyText,
      tag: `line-chat-${line_id}`,
      icon,
      badge: icon,
      data: { url: "/", line_id },
    });

    const results = await Promise.allSettled(
      ((subs as any[]) ?? []).map((s) =>
        webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        ).catch(async (err: any) => {
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            await admin.from("push_subscriptions").delete().eq("id", s.id);
          }
          throw err;
        })
      ),
    );
    const ok = results.filter((r) => r.status === "fulfilled").length;

    return new Response(
      JSON.stringify({ sent: ok, failed: results.length - ok, total: userIds.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("notify-line-chat error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
