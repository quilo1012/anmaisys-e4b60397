// Transcribes a stored voice note (dm-audio bucket) to text via the Lovable AI
// gateway (Gemini, multimodal). Reuses LOVABLE_API_KEY — no new provider/key.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { path } = await req.json().catch(() => ({}));
    if (!path || typeof path !== "string") return json({ error: "path is required" }, 400);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_KEY) return json({ error: "LOVABLE_API_KEY missing" }, 500);

    const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
    const { data: blob, error: dlErr } = await admin.storage.from("dm-audio").download(path);
    if (dlErr || !blob) return json({ error: "audio not found" }, 404);

    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    const b64 = btoa(bin);
    const ext = (path.split(".").pop() || "webm").toLowerCase();
    const format = ext === "mp4" ? "mp4" : ext === "mp3" ? "mp3" : ext === "wav" ? "wav" : ext === "ogg" ? "ogg" : "webm";

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": LOVABLE_KEY },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are a speech transcription engine. Transcribe the audio verbatim in its original language. Return ONLY the transcript text — no quotes, labels or notes. If there is no intelligible speech, return an empty string." },
          {
            role: "user",
            content: [
              { type: "text", text: "Transcribe this voice message." },
              { type: "input_audio", input_audio: { data: b64, format } },
            ],
          },
        ],
      }),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      if (resp.status === 429) return json({ error: "AI rate limit exceeded" }, 429);
      if (resp.status === 402) return json({ error: "AI credits exhausted" }, 402);
      return json({ error: `AI gateway error: ${txt}` }, 500);
    }

    const aiJson = await resp.json();
    const text: string = (aiJson?.choices?.[0]?.message?.content ?? "").trim();
    return json({ text });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
