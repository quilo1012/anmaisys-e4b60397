// Proxies iTouching product/SKU endpoints. Returns a normalized list so the
// admin can preview and import the full product catalogue into sku_products.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTOUCH_URL = (Deno.env.get("INTOUCH_API_URL") ?? "").replace(/\/+$/, "");
const INTOUCH_TOKEN = Deno.env.get("INTOUCH_API_TOKEN") ?? "";

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

    const candidates = [
      "/api/Product", "/api/Products", "/api/GetProducts", "/api/GetProductList",
      "/api/ProductList", "/api/GetAllProducts",
      "/api/SKU", "/api/SKUs", "/api/GetSKUs", "/api/GetSKUList",
      "/api/Item", "/api/GetItems",
    ];
    // Fallback: derive distinct products from job endpoints when no catalog exists.
    const jobFallbacks = [
      "/api/GetRunningJobs", "/api/GetCompletedJobs", "/api/GetJobs",
      "/api/GetJobList", "/api/GetWorkToList",
    ];
    let raw: any = null;
    let usedPath = "";
    let lastErr = "";
    const tryFetch = async (path: string) => {
      const res = await fetch(`${INTOUCH_URL}${path}`, {
        headers: { Authorization: `Bearer ${INTOUCH_TOKEN}`, Accept: "application/json" },
      });
      const txt = await res.text();
      if (!res.ok) { lastErr = `${path} → ${res.status}: ${txt.slice(0, 120)}`; return null; }
      try { return JSON.parse(txt); } catch { lastErr = `${path}: invalid JSON`; return null; }
    };
    for (const path of candidates) {
      try {
        const data = await tryFetch(path);
        if (data != null) { raw = data; usedPath = path; break; }
      } catch (e) { lastErr = `${path}: ${(e as Error).message}`; }
    }
    if (raw == null) {
      for (const path of jobFallbacks) {
        try {
          const data = await tryFetch(path);
          if (data != null) { raw = data; usedPath = `${path} (derived)`; break; }
        } catch (e) { lastErr = `${path}: ${(e as Error).message}`; }
      }
    }
    if (raw == null) {
      // Final fallback: derive SKUs from production_items already captured by
      // intouch-sync-production / Excel imports. iTouching has no public
      // product catalog endpoint on this deployment.
      const { data: items } = await admin
        .from("production_items")
        .select("sku_code, sku_name, target_qty")
        .not("sku_code", "is", null)
        .order("created_at", { ascending: false })
        .limit(5000);
      const map = new Map<string, { code: string; name: string; category: string; target_per_hour: number; raw: any }>();
      for (const it of items ?? []) {
        const code = String(it.sku_code ?? "").trim();
        const name = String(it.sku_name ?? "").trim();
        if (!code || !name) continue;
        if (!map.has(code.toLowerCase())) {
          map.set(code.toLowerCase(), { code, name, category: "", target_per_hour: 0, raw: it });
        }
      }
      const products = Array.from(map.values());
      return new Response(JSON.stringify({
        products, count: products.length,
        source: "production_items (iTouching has no /api product endpoint)",
        fallback: true,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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

    return new Response(JSON.stringify({ products, source: usedPath, count: products.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
