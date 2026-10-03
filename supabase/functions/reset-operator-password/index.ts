import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Max-Age": "86400",
};

/**
 * Repor a password de um posto de operador — ou, deliberadamente, de todos.
 *
 * `user_id` era opcional e omiti-lo repunha TODAS as contas de tablet da fábrica.
 * Um campo que caísse do corpo do pedido por engano — um `undefined` numa variável,
 * uma refactorização no ecrã — tirava o acesso a toda a gente ao mesmo tempo, sem
 * confirmação e sem deixar rasto. O `auditoria-login-operador-2026-09-30.md` chamou-lhe
 * raio de explosão, e tinha razão: a verificação de admin estava certa, o problema era
 * o que um admin conseguia fazer sem querer.
 *
 * Agora as duas intenções dizem-se por extenso. Ou se nomeia o posto (`user_id`), ou
 * se pede a reposição total com `all: true`. Pedir as duas, ou nenhuma, é recusado.
 */
const bodySchema = z
  .object({
    password: z.string().min(6).max(128),
    user_id: z.string().uuid().optional(),
    /** Repor TODAS as contas de operador. Tem de ser dito; não é o que acontece por omissão. */
    all: z.literal(true).optional(),
  })
  .refine((b) => Boolean(b.user_id) !== Boolean(b.all), {
    message:
      "Indique `user_id` para um posto, ou `all: true` para repor todos. Um dos dois, não ambos.",
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user: caller } } = await userClient.auth.getUser();
    if (!caller) throw new Error("Not authenticated");

    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: caller.id, _role: "admin" });
    if (!isAdmin) throw new Error("Only admins may reset operator passwords");

    const { password, user_id, all } = bodySchema.parse(await req.json());

    let targets: { user_id: string; email: string }[] = [];
    if (user_id) {
      const { data, error } = await admin
        .from("operator_line_accounts")
        .select("user_id, email")
        .eq("user_id", user_id)
        .single();
      if (error) throw error;
      targets = [data];
    } else {
      const { data, error } = await admin.from("operator_line_accounts").select("user_id, email");
      if (error) throw error;
      targets = data ?? [];
    }

    let updated = 0;
    const failed: string[] = [];
    for (const t of targets) {
      const { error } = await admin.auth.admin.updateUserById(t.user_id, { password });
      if (error) failed.push(t.email);
      else updated++;
    }

    // Deixa rasto. Repor passwords de operador não deixava nenhum, e quando a fábrica
    // não consegue entrar de manhã a primeira pergunta é se alguém mexeu nisto ontem.
    // A escrita é best-effort: falhar o registo não deve desfazer passwords já repostas.
    const { error: logError } = await admin.from("audit_logs").insert({
      user_id: caller.id,
      user_name: caller.email ?? "Unknown",
      action: "reset_operator_password",
      entity_type: "operator_line_accounts",
      entity_id: user_id ?? null,
      details: {
        scope: all ? "all" : "single",
        targets: targets.length,
        updated,
        failed,
      },
    });
    if (logError) console.error("[reset-operator-password] audit log failed:", logError.message);

    return new Response(JSON.stringify({ success: true, updated, total: targets.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return new Response(JSON.stringify({ error: error.errors[0].message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
