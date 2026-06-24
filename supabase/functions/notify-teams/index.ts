import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3.23.8";

const BodySchema = z.object({
  event: z.enum(["test", "critical_wo", "unassigned_wo", "line_stopped", "line_resumed"]),
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(2000),
  wo_number: z.union([z.string(), z.number()]).optional(),
  machine: z.string().max(200).optional(),
  line: z.string().max(200).optional(),
  priority: z.string().max(40).optional(),
  link: z.string().url().max(500).optional(),
});

type Body = z.infer<typeof BodySchema>;

const COLOR: Record<Body["event"], string> = {
  test: "good",
  critical_wo: "attention",
  unassigned_wo: "warning",
  line_stopped: "attention",
  line_resumed: "good",
};

const ICON: Record<Body["event"], string> = {
  test: "✅",
  critical_wo: "🚨",
  unassigned_wo: "⏰",
  line_stopped: "🛑",
  line_resumed: "▶️",
};

function buildCard(b: Body) {
  const facts: { title: string; value: string }[] = [];
  if (b.wo_number !== undefined) facts.push({ title: "WO", value: String(b.wo_number) });
  if (b.machine) facts.push({ title: "Machine", value: b.machine });
  if (b.line) facts.push({ title: "Line", value: b.line });
  if (b.priority) facts.push({ title: "Priority", value: b.priority });

  const body: any[] = [
    {
      type: "TextBlock",
      size: "Large",
      weight: "Bolder",
      color: COLOR[b.event] === "attention" ? "Attention" : COLOR[b.event] === "warning" ? "Warning" : "Good",
      text: `${ICON[b.event]} ${b.title}`,
      wrap: true,
    },
    { type: "TextBlock", text: b.message, wrap: true, spacing: "Small" },
  ];
  if (facts.length) body.push({ type: "FactSet", facts });

  const actions = b.link
    ? [{ type: "Action.OpenUrl", title: "Open in app", url: b.link }]
    : undefined;

  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body,
          ...(actions ? { actions } : {}),
        },
      },
    ],
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const webhook = Deno.env.get("TEAMS_WEBHOOK_URL");
    if (!webhook) {
      return new Response(
        JSON.stringify({ error: "TEAMS_WEBHOOK_URL secret is not configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const json = await req.json().catch(() => null);
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: "invalid_body", details: parsed.error.flatten().fieldErrors }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const card = buildCard(parsed.data);
    const tRes = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(card),
    });
    const text = await tRes.text();

    if (!tRes.ok) {
      return new Response(
        JSON.stringify({ error: "teams_webhook_failed", status: tRes.status, body: text.slice(0, 500) }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
