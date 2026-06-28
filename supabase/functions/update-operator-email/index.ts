import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Max-Age": "86400",
};

const bodySchema = z.object({
  id: z.string().uuid(),
  email: z.string().email().max(255),
});

const getReadableErrorMessage = (error: unknown) => {
  const anyErr = error as any;
  const message =
    (typeof anyErr?.message === "string" && anyErr.message) ||
    (typeof anyErr?.error_description === "string" && anyErr.error_description) ||
    (typeof anyErr?.error === "string" && anyErr.error) ||
    (typeof anyErr?.hint === "string" && anyErr.hint) ||
    (typeof anyErr?.details === "string" && anyErr.details) ||
    (typeof error === "string" ? error : "") ||
    "Unknown error";

  const lower = message.toLowerCase();
  if (
    lower.includes("users_email_partial_key") ||
    lower.includes("duplicate key") ||
    lower.includes("already been registered") ||
    lower.includes("already registered") ||
    lower.includes("already exists")
  ) {
    return "This email is already in use by another login. Choose another email or delete/restore the existing account first.";
  }
  if (lower.includes("authretryablefetcherror") || lower === "{}" || lower === "unknown error") {
    return "The login email service returned a temporary 500 while changing this email. The system checked whether the change applied; please try again, or create a fresh tablet login with this email.";
  }
  return message;
};

async function updateAuthEmailWithVerification(admin: ReturnType<typeof createClient>, userId: string, newEmail: string) {
  // Updating email + email_confirm in the same Auth Admin call can surface
  // retryable 500/{} errors in GoTrue. Keep this operation minimal, then
  // verify the persisted user before treating retryable errors as fatal.
  const { error: authErr } = await admin.auth.admin.updateUserById(userId, { email: newEmail });
  if (!authErr) return;

  const { data: verifyData, error: verifyErr } = await admin.auth.admin.getUserById(userId);
  const persistedEmail = verifyData?.user?.email?.trim().toLowerCase();
  if (!verifyErr && persistedEmail === newEmail) return;

  console.error("[update-operator-email] auth email update did not persist", {
    userId,
    newEmail,
    persistedEmail,
    authErr,
    verifyErr,
  });
  throw authErr;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: claimsData, error: claimsError } = await admin.auth.getClaims(token);
    if (claimsError || !claimsData?.claims?.sub) throw new Error("Not authenticated");
    const callerId = claimsData.claims.sub as string;

    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: callerId, _role: "admin" });
    const { data: isManager } = await admin.rpc("has_role", { _user_id: callerId, _role: "manager" });
    if (!isAdmin && !isManager) throw new Error("Only admins or managers may update operator emails");

    const { id, email } = bodySchema.parse(await req.json());
    const newEmail = email.trim().toLowerCase();

    // Lookup current operator account
    const { data: acc, error: accErr } = await admin
      .from("operator_line_accounts")
      .select("id, user_id, email")
      .eq("id", id)
      .maybeSingle();
    if (accErr) throw accErr;
    if (!acc) throw new Error("Operator account not found");

    if (acc.email.toLowerCase() === newEmail) {
      return new Response(
        JSON.stringify({ success: true, unchanged: true, email: acc.email }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Ensure no other operator account uses this email
    const { data: clash } = await admin
      .from("operator_line_accounts")
      .select("id")
      .eq("email", newEmail)
      .neq("id", id)
      .maybeSingle();
    if (clash) throw new Error("Another operator account already uses this email");

    // Update auth user (this changes the login email)
    await updateAuthEmailWithVerification(admin, acc.user_id, newEmail);

    // Update operator_line_accounts + profile email
    const { error: olaErr } = await admin
      .from("operator_line_accounts")
      .update({ email: newEmail })
      .eq("id", id);
    if (olaErr) throw olaErr;

    await admin.from("profiles").update({ email: newEmail }).eq("id", acc.user_id);

    return new Response(
      JSON.stringify({ success: true, email: newEmail }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return new Response(JSON.stringify({ error: error.errors[0].message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const anyErr = error as any;
    const message = getReadableErrorMessage(error);
    console.error("[update-operator-email] failed:", message, anyErr);
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
