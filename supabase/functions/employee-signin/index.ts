import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3";

/**
 * employee-signin — the floor signs in with the number on their badge.
 *
 * 209 active employees, 26 with an email on record. An email-and-confirmation sign-up
 * reaches the office; it does not reach a packing line. But every one of them already
 * has a row in `employees`, and 158 have an employee_ref ("E045") printed on a badge.
 * So the account is keyed to that: register once with ID + password + invite code,
 * and the row's user_id is set in the same breath — no "pick your name" step, no
 * pending queue, no email. Sign in afterwards with ID + password.
 *
 * Modelled on tablet-signin, and bound by the same rules: it authenticates rather
 * than verifies a caller, so it rate-limits per ID, answers every failure with the
 * same "Invalid credentials", and ships no default password. The auth identity is a
 * synthetic address nobody receives mail at; the person never sees or types it.
 */

const BodySchema = z.object({
  mode: z.enum(["register", "signin"]),
  employee_ref: z.string().min(2).max(20),
  password: z.string().min(6).max(200),
  invite_code: z.string().min(1).max(100).optional(),
});

const RL_WINDOW_MS = 5 * 60 * 1000;
const RL_MAX_FAILS = 5;
type Bucket = { count: number; firstAt: number; blockedUntil: number };
const attempts = new Map<string, Bucket>();

function checkRateLimit(key: string): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const b = attempts.get(key);
  if (b?.blockedUntil && b.blockedUntil > now) {
    return { allowed: false, retryAfter: Math.ceil((b.blockedUntil - now) / 1000) };
  }
  if (b && now - b.firstAt > RL_WINDOW_MS) attempts.delete(key);
  return { allowed: true, retryAfter: 0 };
}
function recordFailure(key: string) {
  const now = Date.now();
  const b = attempts.get(key);
  if (!b || now - b.firstAt > RL_WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: now, blockedUntil: 0 });
    return;
  }
  b.count += 1;
  if (b.count >= RL_MAX_FAILS) b.blockedUntil = now + RL_WINDOW_MS;
}
function clearAttempts(key: string) { attempts.delete(key); }

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json", ...extra },
  });

/** "E045" → "e045@employee.pmsystem.local". Nobody receives mail here; it is a key. */
const normRef = (ref: string) => ref.trim().toUpperCase().replace(/\s+/g, "");
const emailFor = (ref: string) => `${normRef(ref).toLowerCase()}@employee.pmsystem.local`;

type EmployeeRow = { id: string; full_name: string; employee_ref: string; user_id: string | null; active: boolean };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ error: "Invalid request" }, 400);
    const { mode, password, invite_code } = parsed.data;
    const ref = normRef(parsed.data.employee_ref);

    const gate = checkRateLimit(ref);
    if (!gate.allowed) {
      return json({ error: "Too many attempts. Try again later.", retry_after: gate.retryAfter }, 429,
        { "Retry-After": String(gate.retryAfter) });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const anon = createClient(SUPABASE_URL, ANON_KEY);

    const { data: emp } = await admin
      .from("employees")
      .select("id, full_name, employee_ref, user_id, active")
      .ilike("employee_ref", ref)
      .eq("active", true)
      .maybeSingle();
    const employee = emp as EmployeeRow | null;

    if (mode === "register") {
      // The invite code is the gate; past it, the answers can be specific.
      const { data: codeOk } = await admin.rpc("check_invite_code", { code: (invite_code ?? "").trim() });
      if (!codeOk) {
        recordFailure(ref);
        return json({ error: "That invite code isn't valid any more — it may have expired. Ask your supervisor." }, 403);
      }
      if (!employee) {
        recordFailure(ref);
        return json({ error: `No active employee has ID ${ref}. Check the number on your badge, or ask your supervisor to add it.` }, 404);
      }
      if (employee.user_id) {
        recordFailure(ref);
        return json({ error: `ID ${ref} already has an account. Sign in with it instead, or ask your supervisor to reset the password.` }, 409);
      }

      const email = emailFor(ref);
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { name: employee.full_name, employee_ref: ref, employee_signin: "true" },
      });
      if (createErr || !created.user?.id) {
        console.error("employee-signin createUser", createErr);
        return json({ error: "Could not create the account. Try again, or ask your supervisor." }, 500);
      }
      const uid = created.user.id;

      // Active, operator, linked — in that order, and all three before the session.
      const { error: profErr } = await admin.from("profiles")
        .upsert({ id: uid, name: employee.full_name, email, active: true }, { onConflict: "id" });
      if (profErr) console.error("profiles upsert", profErr);
      const { error: roleErr } = await admin.from("user_roles")
        .upsert({ user_id: uid, role: "operator" }, { onConflict: "user_id" });
      if (roleErr) console.error("user_roles upsert", roleErr);
      const { error: linkErr } = await admin.from("employees")
        .update({ user_id: uid }).eq("id", employee.id).is("user_id", null);
      if (linkErr) console.error("employees link", linkErr);

      // Admins hear about it, quietly.
      const { data: admins } = await admin.from("user_roles").select("user_id").eq("role", "admin");
      if (admins?.length) {
        await admin.from("notifications").insert(admins.map((a: { user_id: string }) => ({
          user_id: a.user_id, title: "New operator account",
          body: `${employee.full_name} (${ref}) registered with their employee ID and is active.`,
          priority: "low", action_url: "/users/manage",
        })));
      }
    } else if (!employee?.user_id) {
      recordFailure(ref);
      return json({ error: "Invalid credentials" }, 401);
    }

    // Sign in: the auth identity's email is whatever it was created with. Prefer the
    // live record over recomputing, in case an admin ever re-keyed a badge.
    let email = emailFor(ref);
    if (employee?.user_id) {
      const { data: u } = await admin.auth.admin.getUserById(employee.user_id);
      if (u?.user?.email) email = u.user.email;
    }
    const { data: signIn, error: signErr } = await anon.auth.signInWithPassword({ email, password });
    if (signErr || !signIn.session) {
      recordFailure(ref);
      return json({ error: "Invalid credentials" }, 401);
    }
    clearAttempts(ref);

    return json({
      access_token: signIn.session.access_token,
      refresh_token: signIn.session.refresh_token,
      expires_at: signIn.session.expires_at,
      expires_in: signIn.session.expires_in,
      token_type: signIn.session.token_type,
      user_id: signIn.user?.id ?? null,
      full_name: employee?.full_name ?? null,
    });
  } catch (e) {
    console.error("employee-signin error", e);
    return json({ error: "Sign-in failed" }, 500);
  }
});
