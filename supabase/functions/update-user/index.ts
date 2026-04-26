import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";
import bcrypt from "https://esm.sh/bcryptjs@2.4.3";

const createPendingPinHash = async () => {
  return bcrypt.hash(crypto.randomUUID(), 10);
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Max-Age": "86400",
};

const updateUserSchema = z.object({
  userId: z.string().uuid("Invalid user ID"),
  name: z.string().trim().min(1).max(100).optional(),
  role: z.enum(["admin", "manager", "engineer", "operator"]).optional(),
  shift: z.string().max(50).optional(),
  active: z.boolean().optional(),
  email: z.string().email("Invalid email format").max(255).optional(),
  password: z.string().min(6, "Password must be at least 6 characters").max(128).optional(),
  labor_rate: z.number().min(0).optional(),
});

const getReadableErrorMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";

  const lower = message.toLowerCase();
  if (
    lower.includes("known to be weak and easy to guess") ||
    lower.includes("pwned") ||
    lower.includes("compromised") ||
    lower.includes("leaked")
  ) {
    return "This password has appeared in a known data breach and was rejected. Please choose a different, stronger password (e.g. mix of letters, numbers, and symbols not used elsewhere).";
  }
  if (lower.includes("weak password") || lower.includes("should be at least")) {
    return message;
  }

  return message;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: claimsData, error: claimsError } = await supabaseAdmin.auth.getClaims(token);
    if (claimsError || !claimsData?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const callerId = claimsData.claims.sub as string;

    const { data: isAdmin } = await supabaseAdmin.rpc("has_role", { _user_id: callerId, _role: "admin" });
    const { data: isManager } = await supabaseAdmin.rpc("has_role", { _user_id: callerId, _role: "manager" });

    if (!isAdmin && !isManager) throw new Error("Only managers and admins can update users");

    const body = updateUserSchema.parse(await req.json());
    const { userId, name, role, shift, active, email, password, labor_rate } = body;

    const { data: targetRole } = await supabaseAdmin.rpc("get_user_role", { _user_id: userId });

    if (isManager && !isAdmin && (targetRole === "admin" || targetRole === "manager")) {
      throw new Error("Managers cannot modify Manager or Admin users");
    }

    if (isManager && !isAdmin && role && role !== "engineer" && role !== "operator") {
      throw new Error("Managers can only assign Engineer or Operator roles");
    }

    if (role === "admin" && !isAdmin) throw new Error("Only admins can assign the Admin role");
    if (labor_rate !== undefined && !isAdmin) {
      throw new Error("Only admins can modify labor rates");
    }

    if (email) {
      const { error: emailError } = await supabaseAdmin.auth.admin.updateUserById(userId, { email });
      if (emailError) throw new Error(getReadableErrorMessage(emailError));
      await supabaseAdmin.from("profiles").update({ email }).eq("id", userId);
    }

    if (password) {
      const { error: pwError } = await supabaseAdmin.auth.admin.updateUserById(userId, { password });
      if (pwError) throw new Error(getReadableErrorMessage(pwError));
    }

    const profileUpdate: Record<string, unknown> = {};
    if (name !== undefined) profileUpdate.name = name;
    if (shift !== undefined) profileUpdate.shift = shift;
    if (active !== undefined) profileUpdate.active = active;
    if (labor_rate !== undefined) profileUpdate.labor_rate = labor_rate;

    if (Object.keys(profileUpdate).length > 0) {
      const { error: profileError } = await supabaseAdmin
        .from("profiles")
        .update(profileUpdate)
        .eq("id", userId);
      if (profileError) throw profileError;
    }

    if (role) {
      const { data: existingRole } = await supabaseAdmin
        .from("user_roles")
        .select("id")
        .eq("user_id", userId)
        .maybeSingle();

      if (existingRole) {
        const { error: roleError } = await supabaseAdmin
          .from("user_roles")
          .update({ role })
          .eq("user_id", userId);
        if (roleError) throw roleError;
      } else {
        const { error: roleError } = await supabaseAdmin
          .from("user_roles")
          .insert({ user_id: userId, role });
        if (roleError) throw roleError;
      }

      if (role === "engineer") {
        const { data: existingEngineer, error: existingEngineerError } = await supabaseAdmin
          .from("engineers")
          .select("id")
          .eq("id", userId)
          .maybeSingle();
        if (existingEngineerError) throw existingEngineerError;

        const engineerName = name ?? editFallbackName(profileUpdate) ?? undefined;

        if (existingEngineer) {
          const engineerUpdate: Record<string, unknown> = { is_active: active ?? true };
          if (engineerName) engineerUpdate.name = engineerName;

          const { error: engineerUpdateError } = await supabaseAdmin
            .from("engineers")
            .update(engineerUpdate)
            .eq("id", userId);
          if (engineerUpdateError) throw engineerUpdateError;
        } else {
          const pinHash = await createPendingPinHash();
          const { data: profileRow, error: profileLookupError } = await supabaseAdmin
            .from("profiles")
            .select("name")
            .eq("id", userId)
            .single();
          if (profileLookupError) throw profileLookupError;

          const { error: engineerInsertError } = await supabaseAdmin
            .from("engineers")
            .insert({
              id: userId,
              name: engineerName ?? profileRow.name,
              pin_hash: pinHash,
              is_active: active ?? true,
            });
          if (engineerInsertError) throw engineerInsertError;
        }
      } else {
        const { error: engineerDeleteError } = await supabaseAdmin
          .from("engineers")
          .delete()
          .eq("id", userId);
        if (engineerDeleteError) throw engineerDeleteError;
      }
    } else if (name !== undefined || active !== undefined) {
      const { data: existingEngineer, error: existingEngineerError } = await supabaseAdmin
        .from("engineers")
        .select("id")
        .eq("id", userId)
        .maybeSingle();
      if (existingEngineerError) throw existingEngineerError;

      if (existingEngineer) {
        const engineerUpdate: Record<string, unknown> = {};
        if (name !== undefined) engineerUpdate.name = name;
        if (active !== undefined) engineerUpdate.is_active = active;

        if (Object.keys(engineerUpdate).length > 0) {
          const { error: engineerUpdateError } = await supabaseAdmin
            .from("engineers")
            .update(engineerUpdate)
            .eq("id", userId);
          if (engineerUpdateError) throw engineerUpdateError;
        }
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return new Response(JSON.stringify({ error: error.errors[0].message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: getReadableErrorMessage(error) }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function editFallbackName(profileUpdate: Record<string, unknown>) {
  const candidate = profileUpdate.name;
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate.trim() : null;
}
