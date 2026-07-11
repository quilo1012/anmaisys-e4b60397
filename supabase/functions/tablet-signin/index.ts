import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3";

const BodySchema = z.object({
  account_id: z.string().uuid(),
  password: z.string().min(1).max(200),
});

const DEFAULT_TABLET_PASSWORD = "Tablet@AN2026!";

// In-memory rate limit: 5 failed attempts per account_id in a 5-min window → 429.
// Resets on successful sign-in. Per-instance only (best-effort), acceptable here
// because tablets share a small pool of operator accounts and brute-force on a
// single instance is the realistic threat model.
const RL_WINDOW_MS = 5 * 60 * 1000;
const RL_MAX_FAILS = 5;
type Bucket = { count: number; firstAt: number; blockedUntil: number };
const attempts = new Map<string, Bucket>();

type TabletAccount = {
  id: string;
  user_id: string | null;
  email: string;
  label: string;
  line_ids: string[] | null;
};

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
  if (b.count >= RL_MAX_FAILS) {
    b.blockedUntil = now + RL_WINDOW_MS;
  }
}

function clearAttempts(key: string) {
  attempts.delete(key);
}

async function ensureOperatorIdentity(admin: ReturnType<typeof createClient>, acc: TabletAccount) {
  let userId = acc.user_id;

  if (userId) {
    const { data: existing } = await admin.auth.admin.getUserById(userId);
    if (existing?.user) return existing.user.id;
  }

  const { data: usersByEmail, error: listErr } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (listErr) throw listErr;
  const existingByEmail = usersByEmail.users.find(
    (user) => user.email?.toLowerCase() === acc.email.toLowerCase(),
  );

  if (existingByEmail) {
    userId = existingByEmail.id;
  } else {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: acc.email,
      password: DEFAULT_TABLET_PASSWORD,
      email_confirm: true,
      user_metadata: { name: acc.label },
    });
    if (createErr) throw createErr;
    if (!created.user?.id) throw new Error("Failed to create tablet user");
    userId = created.user.id;
  }

  const { error: accountErr } = await admin
    .from("operator_line_accounts")
    .update({ user_id: userId })
    .eq("id", acc.id);
  if (accountErr) throw accountErr;

  const { error: profileErr } = await admin
    .from("profiles")
    .upsert({ id: userId, name: acc.label, email: acc.email, active: true }, { onConflict: "id" });
  if (profileErr) throw profileErr;

  const { error: roleErr } = await admin
    .from("user_roles")
    .upsert({ user_id: userId, role: "operator" }, { onConflict: "user_id,role" });
  if (roleErr) throw roleErr;

  return userId;
}

async function signInTablet(SUPABASE_URL: string, ANON_KEY: string, email: string, password: string) {
  const anon = createClient(SUPABASE_URL, ANON_KEY);
  return anon.auth.signInWithPassword({ email, password });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }


  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: "Invalid request" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const { account_id, password } = parsed.data;

    // Rate-limit per account_id (server resolves email, so this is the stable key)
    const gate = checkRateLimit(account_id);
    if (!gate.allowed) {
      return new Response(
        JSON.stringify({ error: "Too many attempts. Try again later.", retry_after: gate.retryAfter }),
        {
          status: 429,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
            "Retry-After": String(gate.retryAfter),
          },
        },
      );
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Resolve email server-side using service role (never exposed to client)
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: acc, error: accErr } = await admin
      .from("operator_line_accounts")
      .select("id, user_id, email, label, line_ids")
      .eq("id", account_id)
      .maybeSingle();

    if (accErr || !acc?.email) {
      recordFailure(account_id);
      // Generic message to avoid account enumeration
      return new Response(
        JSON.stringify({ error: "Invalid credentials" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    await ensureOperatorIdentity(admin, acc as TabletAccount);

    // Perform sign-in with a fresh anon client.
    let { data: signIn, error: signErr } = await signInTablet(SUPABASE_URL, ANON_KEY, acc.email, password);

    // Some tablet rows existed without a matching auth user, and older tablets
    // may still have the previous default hash. When the operator enters the
    // approved default password, repair the auth password server-side and retry.
    if ((signErr || !signIn.session) && password === DEFAULT_TABLET_PASSWORD) {
      const { data: authUsers, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (listErr) throw listErr;
      const user = authUsers.users.find((u) => u.email?.toLowerCase() === acc.email.toLowerCase());
      if (user?.id) {
        await admin.auth.admin.updateUserById(user.id, {
          password: DEFAULT_TABLET_PASSWORD,
          email_confirm: true,
          user_metadata: { name: acc.label },
        });
        const retry = await signInTablet(SUPABASE_URL, ANON_KEY, acc.email, password);
        signIn = retry.data;
        signErr = retry.error;
      }
    }

    if (signErr || !signIn.session) {
      recordFailure(account_id);
      return new Response(
        JSON.stringify({ error: "Invalid credentials" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    clearAttempts(account_id);


    // Return session tokens only — no email, no user object
    return new Response(
      JSON.stringify({
        access_token: signIn.session.access_token,
        refresh_token: signIn.session.refresh_token,
        expires_at: signIn.session.expires_at,
        expires_in: signIn.session.expires_in,
        token_type: signIn.session.token_type,
        user_id: signIn.user?.id ?? null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("tablet-signin error", e);
    return new Response(
      JSON.stringify({ error: "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
