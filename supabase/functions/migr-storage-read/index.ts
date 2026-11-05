// TEMPORARIA (migracao para o AN Maintenance, 05/11/2026). Apagar quando os ficheiros estiverem copiados.
// Le um ficheiro do storage deste projeto e devolve-o. So responde a quem apresenta o segredo da migracao
// no cabecalho x-webhook-secret (comparado por sha256).
import { createClient } from "npm:@supabase/supabase-js@2";

const SECRET_SHA256 = "ac91eecc935da5c9a27355d761a8feab38f85aeb7459c9c71a8c0aced008f722";

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  const presented = (req.headers.get("x-webhook-secret") ?? "").trim();
  if (!presented || (await sha256Hex(presented)) !== SECRET_SHA256) return json({ error: "unauthorized" }, 401);

  const url = new URL(req.url);
  const bucket = url.searchParams.get("bucket") ?? "";
  const path = url.searchParams.get("path") ?? "";
  if (!bucket || !path) return json({ error: "bucket and path are required" }, 400);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await admin.storage.from(bucket).download(path);
  if (error || !data) return json({ error: error?.message ?? "not found" }, 404);
  return new Response(data, { status: 200, headers: { "Content-Type": data.type || "application/octet-stream" } });
});
