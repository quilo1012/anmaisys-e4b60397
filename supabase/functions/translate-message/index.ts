import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_TEXT_LENGTH = 5000;
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
// Tarefa curta e de grande volume: o Haiku é o mais rápido e o mais barato.
const MODEL = "claude-haiku-4-5-20251001";

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

    const { text, mode } = await req.json().catch(() => ({ text: "", mode: undefined }));
    if (!text || typeof text !== "string") {
      return json({ error: "text is required" }, 400);
    }
    if (text.length > MAX_TEXT_LENGTH) {
      return json({ error: `text must be at most ${MAX_TEXT_LENGTH} characters` }, 400);
    }

    const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_KEY) return json({ error: "ANTHROPIC_API_KEY missing" }, 500);

    // No Claude o system prompt é um campo de topo, não uma mensagem com role.
    const system =
      mode === "polish"
        ? "You clean up maintenance reports written by factory engineers. Translate the text to natural, professional English if it is in another language. If it is already English, keep the meaning exactly but fix spelling, grammar and punctuation. Never invent facts, never add or remove information, keep it short and technical. Return ONLY the corrected English text, with no quotes, notes or explanations."
        : mode === "part_search"
        ? "You translate spare part names used in a factory maintenance warehouse from Portuguese (or any language) into the English term printed on the part catalogue. Reply with ONLY the short English part name, 1 to 3 words, no punctuation, no explanation. Examples: 'rolamento' -> 'bearing', 'correia dentada' -> 'timing belt', 'parafuso' -> 'screw', 'mangueira de ar' -> 'air hose'. If the text is already English, return it unchanged."
        : "You are a translator. Translate the user's message to natural English. Return ONLY the translation, no quotes or notes. If the text is already English, return it unchanged.";

    const resp = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system,
        messages: [{ role: "user", content: text }],
      }),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      if (resp.status === 429) return json({ error: "AI rate limit exceeded" }, 429);
      if (resp.status === 401 || resp.status === 403) {
        return json({ error: "AI key rejected — check ANTHROPIC_API_KEY and billing" }, 502);
      }
      return json({ error: `AI error: ${txt.slice(0, 300)}` }, 502);
    }

    const aiJson = await resp.json();
    const translated: string = extractText(aiJson).trim();
    return json({ translated: translated || text });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

/** A resposta do Claude vem em content[]; o texto está nos blocos de type "text". */
function extractText(aiJson: unknown): string {
  const blocks = (aiJson as { content?: Array<{ type?: string; text?: string }> })?.content;
  if (!Array.isArray(blocks)) return "";
  return blocks
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
