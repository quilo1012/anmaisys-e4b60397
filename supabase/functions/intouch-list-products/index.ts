// Proxies iTouching product/SKU endpoints. Returns a normalized list so the
// admin can preview and import the full product catalogue into sku_products.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTOUCH_URL = (Deno.env.get("INTOUCH_API_URL") ?? "").replace(/\/+$/, "");
const INTOUCH_TOKEN = Deno.env.get("INTOUCH_API_TOKEN") ?? "";
const INTOUCH_AUTH_HEADER = /^bearer\s+/i.test(INTOUCH_TOKEN.trim())
  ? INTOUCH_TOKEN.trim()
  : `Bearer ${INTOUCH_TOKEN.trim()}`;

const ITOUCH_TIMEOUT_MS = 10_000;
const __QUOTA_ADMIN_PROD = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
const tomorrowUtcMidnight = () => {
  const d = new Date(); d.setUTCDate(d.getUTCDate() + 1); d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
};
async function intouchQuotaBlockedUntil(): Promise<string | null> {
  try {
    const { data } = await __QUOTA_ADMIN_PROD
      .from("intouch_quota_status").select("blocked_until")
      .eq("id", "singleton").maybeSingle();
    if (data?.blocked_until && new Date(data.blocked_until).getTime() > Date.now()) {
      return data.blocked_until as string;
    }
  } catch { /* best-effort */ }
  return null;
}
async function intouchMarkEgressExceeded() {
  try {
    await __QUOTA_ADMIN_PROD.from("intouch_quota_status").upsert({
      id: "singleton", blocked_until: tomorrowUtcMidnight(), updated_at: new Date().toISOString(),
    });
  } catch { /* best-effort */ }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Authenticate via JWKS-validated claims (Lovable Cloud signing-keys).
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const authClient = createClient(SUPABASE_URL, ANON, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: claimsData, error: claimsErr } = await authClient.auth.getClaims(token);
    const userId = claimsData?.claims?.sub as string | undefined;
    if (claimsErr || !userId) {
      return new Response(JSON.stringify({ error: "invalid_token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", userId);
    const ok = (roles ?? []).some((r) => ["admin", "manager"].includes(r.role));
    if (!ok) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const blockedUntil = await intouchQuotaBlockedUntil();
    if (blockedUntil) {
      const { data: skus, error: skuErr } = await admin
        .from("sku_products")
        .select("code, name, category, target_per_hour")
        .eq("active", true)
        .order("code", { ascending: true })
        .limit(5000);
      if (skuErr) throw skuErr;
      const products = (skus ?? []).map((s) => ({
        code: String(s.code ?? "").trim(),
        name: String(s.name ?? "").trim(),
        category: String(s.category ?? "").trim(),
        target_per_hour: Number(s.target_per_hour ?? 0),
        raw: s,
      })).filter((p) => p.code && p.name);
      return new Response(JSON.stringify({
        products,
        count: products.length,
        source: "sku_products (local catalog — iTouching quota exhausted)",
        cached: true,
        skipped: true,
        reason: "quota_exhausted",
        retry_after: blockedUntil,
        error: "iTouching daily quota exhausted",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const candidates = [
      "/api/Product", "/api/Products", "/api/GetProducts", "/api/GetProductList",
      "/api/ProductList", "/api/GetAllProducts",
      "/api/SKU", "/api/SKUs", "/api/GetSKUs", "/api/GetSKUList",
      "/api/Item", "/api/GetItems",
    ];
    let raw: any = null;
    let usedPath = "";
    let lastErr = "";
    let quotaHit = false;
    const tryFetch = async (path: string, init?: RequestInit) => {
      if (quotaHit) return null;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ITOUCH_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(`${INTOUCH_URL}${path}`, {
          ...(init ?? {}),
          signal: controller.signal,
          headers: {
            Authorization: INTOUCH_AUTH_HEADER,
            Accept: "application/json",
            "Content-Type": "application/json",
            ...(init?.headers ?? {}),
          },
        });
      } catch (e) {
        if ((e as any)?.name === "AbortError") { lastErr = `${path}: iTouching API timeout`; return null; }
        lastErr = `${path}: ${(e as Error).message}`; return null;
      } finally {
        clearTimeout(timer);
      }
      const txt = await res.text();
      if (txt.includes("Exceeded API Max daily egress")) {
        await intouchMarkEgressExceeded();
        quotaHit = true;
        lastErr = "iTouching daily quota exhausted";
        return null;
      }
      if (!res.ok) { lastErr = `${path} → ${res.status}: ${txt.slice(0, 120)}`; return null; }
      try { return JSON.parse(txt); } catch { lastErr = `${path}: invalid JSON`; return null; }
    };
    for (const path of candidates) {
      try {
        const data = await tryFetch(path);
        if (data != null) { raw = data; usedPath = path; break; }
      } catch (e) { lastErr = `${path}: ${(e as Error).message}`; }
    }

    // Job-derived fallback: walk Running + Completed + Scheduled job payloads
    // and extract every distinct Product/SKU appearing inside them.
    const walk = (node: any, cb: (o: any) => void) => {
      if (!node) return;
      if (Array.isArray(node)) { for (const n of node) walk(n, cb); return; }
      if (typeof node === "object") {
        cb(node);
        for (const k of Object.keys(node)) walk(node[k], cb);
      }
    };
    const pickStr = (o: any, keys: string[]) => {
      for (const k of keys) {
        const v = o?.[k];
        if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
      }
      return "";
    };
    const pickNum = (o: any, keys: string[]) => {
      for (const k of keys) {
        const v = o?.[k];
        if (v !== undefined && v !== null && String(v).trim() !== "") {
          const n = Number(String(v).replace(",", "."));
          if (!isNaN(n)) return n;
        }
      }
      return 0;
    };
    const jobProducts = new Map<string, { code: string; name: string; category: string; target_per_hour: number; raw: any }>();
    const harvest = (payload: any) => {
      walk(payload, (o) => {
        const code = pickStr(o, ["ProductCode", "SkuCode", "SKUCode", "SKU", "Sku", "ItemCode", "JobProductCode", "Code"]);
        const name = pickStr(o, ["ProductName", "SkuName", "SKUName", "ItemName", "JobProductName", "ProductDescription", "Description", "Name"]);
        if (!code || !name) return;
        const k = code.toLowerCase();
        if (jobProducts.has(k)) return;
        jobProducts.set(k, {
          code, name,
          category: pickStr(o, ["Category", "ProductCategory", "Group", "GroupName", "Family"]),
          target_per_hour: pickNum(o, ["TargetPerHour", "RatePerHour", "StandardRate", "UPH", "RunRate", "StandardUPH", "Target"]),
          raw: o,
        });
      });
    };

    if (raw == null) {
      // 1) Pull running jobs (GET) — contains current product context.
      const running = await tryFetch("/api/GetRunningJobs", { method: "GET" });
      if (running) { harvest(running); usedPath = "/api/GetRunningJobs (derived)"; }

      // 2) Collect job IDs and hydrate full records via POST /api/GetJobs.
      const jobIds = new Set<string>();
      walk(running, (o) => {
        const jid = pickStr(o, ["WorskOrderID", "WorksOrderID", "JobID", "JobId", "JobGUID", "JobGuid", "ID", "Id"]);
        if (jid && jid.length >= 8) jobIds.add(jid);
      });
      if (jobIds.size > 0) {
        const jobs = await tryFetch("/api/GetJobs", { method: "POST", body: JSON.stringify(Array.from(jobIds)) });
        if (jobs) { harvest(jobs); usedPath = "/api/GetJobs (derived)"; }
      }

      // 3) Pull historical jobs ran in the last 30 days for catalog breadth.
      const endISO = new Date().toISOString();
      const startISO = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      const ranAttempts = [
        () => tryFetch(`/api/GetJobsRanDuringPeriod?StartTime=${encodeURIComponent(startISO)}&EndTime=${encodeURIComponent(endISO)}`, { method: "POST", body: JSON.stringify([]) }),
        () => tryFetch(`/api/GetJobsRan?StartTime=${encodeURIComponent(startISO)}&EndTime=${encodeURIComponent(endISO)}`, { method: "POST", body: JSON.stringify([]) }),
      ];
      for (const a of ranAttempts) {
        try { const d = await a(); if (d) { harvest(d); usedPath = usedPath || "/api/GetJobsRan (derived)"; } } catch { /* ignore */ }
      }
    }

    if (raw == null && jobProducts.size === 0) {
      // Final fallback: return the local sku_products catalog.
      const { data: skus, error: skuErr } = await admin
        .from("sku_products")
        .select("code, name, category, target_per_hour")
        .eq("active", true)
        .order("code", { ascending: true })
        .limit(5000);
      if (skuErr) throw skuErr;
      const products = (skus ?? []).map((s) => ({
        code: String(s.code ?? "").trim(),
        name: String(s.name ?? "").trim(),
        category: String(s.category ?? "").trim(),
        target_per_hour: Number(s.target_per_hour ?? 0),
        raw: s,
      })).filter((p) => p.code && p.name);
      return new Response(JSON.stringify({
        products, count: products.length,
        source: "sku_products (local catalog — iTouching returned no jobs/products)",
        fallback: true,
        last_error: lastErr || null,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (raw == null) {
      const products = Array.from(jobProducts.values());
      return new Response(JSON.stringify({
        products, count: products.length, source: usedPath || "iTouching jobs (derived)",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }



    const list: any[] = Array.isArray(raw)
      ? raw
      : (raw.Products ?? raw.products ?? raw.SKUs ?? raw.Items ?? raw.items ?? raw.Jobs ?? raw.jobs ?? raw.data ?? raw.Result ?? raw.result ?? []);

    const pick = (o: any, keys: string[]) => {
      for (const k of keys) {
        const v = o?.[k];
        if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
      }
      return "";
    };
    const num = (o: any, keys: string[]) => {
      for (const k of keys) {
        const v = o?.[k];
        if (v !== undefined && v !== null && String(v).trim() !== "") {
          const n = Number(String(v).replace(",", "."));
          if (!isNaN(n)) return n;
        }
      }
      return 0;
    };

    const mapped = list.map((p) => ({
      code: pick(p, ["ProductCode", "Code", "SKU", "Sku", "SkuCode", "ItemCode", "ProductID", "ProductId", "JobProductCode", "Id", "ID", "id"]),
      name: pick(p, ["ProductName", "Name", "Description", "SkuName", "ItemName", "JobProductName", "description", "name"]),
      category: pick(p, ["Category", "ProductCategory", "Group", "GroupName", "Family"]),
      target_per_hour: num(p, ["TargetPerHour", "RatePerHour", "StandardRate", "UPH", "Target", "RunRate", "StandardUPH"]),
      raw: p,
    })).filter((p) => p.code && p.name);
    const seen = new Set<string>();
    const products = mapped.filter((p) => {
      const k = p.code.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });

    if (products.length === 0) {
      const { data: skus } = await admin
        .from("sku_products")
        .select("code, name, category, target_per_hour")
        .eq("active", true)
        .order("code", { ascending: true })
        .limit(5000);
      const fb = (skus ?? []).map((s) => ({
        code: String(s.code ?? "").trim(),
        name: String(s.name ?? "").trim(),
        category: String(s.category ?? "").trim(),
        target_per_hour: Number(s.target_per_hour ?? 0),
        raw: s,
      })).filter((p) => p.code && p.name);
      return new Response(JSON.stringify({
        products: fb, count: fb.length,
        source: `sku_products (local catalog — iTouching ${usedPath || "endpoints"} returned no products)`,
        fallback: true, last_error: lastErr || null,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ products, source: usedPath, count: products.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
