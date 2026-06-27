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
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", user.id);
    const ok = (roles ?? []).some((r) => ["admin", "manager"].includes(r.role));
    if (!ok) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const candidates = [
      "/api/Product", "/api/Products", "/api/GetProducts", "/api/GetProductList",
      "/api/SKU", "/api/SKUs", "/api/GetSKUs", "/api/Item", "/api/Items",
    ];
    let raw: any = null;
    let usedPath = "";
    let lastErr = "";
    for (const path of candidates) {
      try {
        const res = await fetch(`${INTOUCH_URL}${path}`, {
          headers: { Authorization: `Bearer ${INTOUCH_TOKEN}`, Accept: "application/json" },
        });
        const txt = await res.text();
        if (!res.ok) { lastErr = `${path} → ${res.status}: ${txt.slice(0, 160)}`; continue; }
        try { raw = JSON.parse(txt); usedPath = path; break; }
        catch { lastErr = `${path}: invalid JSON`; }
      } catch (e) { lastErr = `${path}: ${(e as Error).message}`; }
    }
    if (raw == null) throw new Error(`iTouching: no product endpoint returned JSON. ${lastErr}`);

    const list: any[] = Array.isArray(raw)
      ? raw
      : (raw.Products ?? raw.products ?? raw.SKUs ?? raw.Items ?? raw.items ?? raw.data ?? raw.Result ?? raw.result ?? []);

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

    const products = list.map((p) => ({
      code: pick(p, ["ProductCode", "Code", "SKU", "Sku", "SkuCode", "ItemCode", "ProductID", "ProductId", "Id", "ID", "id"]),
      name: pick(p, ["ProductName", "Name", "Description", "SkuName", "ItemName", "description", "name"]),
      category: pick(p, ["Category", "ProductCategory", "Group", "GroupName", "Family"]),
      target_per_hour: num(p, ["TargetPerHour", "RatePerHour", "StandardRate", "UPH", "Target", "RunRate", "StandardUPH"]),
      raw: p,
    })).filter((p) => p.code && p.name);

    return new Response(JSON.stringify({ products, source: usedPath, count: products.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
