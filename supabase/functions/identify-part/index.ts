import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// A search, not a record: the photograph is read in memory and never written
// anywhere — not to `part-photos`, not to a table, not to a log.
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_CANDIDATES = 5;

interface Candidate {
  code: string;
  confidence: number;
  reason: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: claimsData, error: claimsErr } = await authClient.auth.getClaims(
      authHeader.replace("Bearer ", ""),
    );
    if (claimsErr || !claimsData?.claims?.sub) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const image: unknown = body?.image;
    if (typeof image !== "string" || !image.startsWith("data:image/")) {
      return json({ error: "image must be a data:image/... URL" }, 400);
    }
    if (image.length > MAX_IMAGE_BYTES) {
      return json({ error: "image is too large — take the photo again" }, 400);
    }

    const LOVABLE_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_KEY) return json({ error: "LOVABLE_API_KEY missing" }, 500);

    // The catalogue is read with the caller's own rights: whoever can see the Stock
    // screen can search it, and nobody sees more here than there.
    const { data: products, error: prodErr } = await authClient
      .from("products")
      .select("code, name, category, description, machine, line")
      .order("code");
    if (prodErr) return json({ error: prodErr.message }, 400);
    if (!products?.length) return json({ description: "", candidates: [] });

    const catalogue = products
      .map((p) =>
        [
          `code=${p.code}`,
          `name=${p.name}`,
          `category=${p.category}`,
          p.description ? `description=${String(p.description).replace(/\s+/g, " ")}` : "",
          p.machine ? `machine=${p.machine}` : "",
          p.line ? `line=${p.line}` : "",
        ].filter(Boolean).join(" | "),
      )
      .join("\n");

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": LOVABLE_KEY },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content:
              "You identify maintenance spare parts from a photograph, matching them against a fixed catalogue.\n" +
              "Reply with JSON only, no prose and no code fences, shaped exactly:\n" +
              '{"description":"what the part in the photo appears to be, one short sentence",' +
              '"candidates":[{"code":"<catalogue code, verbatim>","confidence":0.0,"reason":"why this matches, one short sentence"}]}\n' +
              `Rules: at most ${MAX_CANDIDATES} candidates, ordered most to least likely. ` +
              "Use only codes present in the catalogue — never invent one. " +
              "confidence is 0..1. If nothing in the catalogue plausibly matches, return an empty candidates array " +
              "but still fill description. Answer in English.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: `Catalogue (one part per line):\n${catalogue}` },
              { type: "text", text: "Identify the part in this photograph and list the catalogue candidates." },
              { type: "image_url", image_url: { url: image } },
            ],
          },
        ],
      }),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      if (resp.status === 429) return json({ error: "AI is rate limited — try again in a moment." }, 429);
      if (resp.status === 402) return json({ error: "AI credits exhausted — ask the workspace owner to top up." }, 402);
      if (resp.status === 403) return json({ error: "AI access is blocked for this workspace." }, 403);
      return json({ error: `AI gateway error: ${txt.slice(0, 300)}` }, 502);
    }

    const aiJson = await resp.json();
    const raw: string = aiJson?.choices?.[0]?.message?.content ?? "";
    const parsed = parseJson(raw);
    if (!parsed) return json({ error: "The model did not return a readable answer. Try another angle." }, 502);

    const byCode = new Map(products.map((p) => [String(p.code).toLowerCase(), p]));
    const seen = new Set<string>();
    const candidates = (Array.isArray(parsed.candidates) ? parsed.candidates : [])
      .map((c: Candidate) => {
        const hit = byCode.get(String(c?.code ?? "").trim().toLowerCase());
        if (!hit) return null;
        const key = String(hit.code);
        if (seen.has(key)) return null;
        seen.add(key);
        const conf = Number(c?.confidence);
        return {
          code: hit.code,
          name: hit.name,
          category: hit.category,
          confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0,
          reason: typeof c?.reason === "string" ? c.reason.slice(0, 240) : "",
        };
      })
      .filter(Boolean)
      .slice(0, MAX_CANDIDATES);

    return json({
      description: typeof parsed.description === "string" ? parsed.description.slice(0, 400) : "",
      candidates,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

/** The model is asked for bare JSON; some answers still arrive fenced. */
function parseJson(text: string): { description?: unknown; candidates?: unknown } | null {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
