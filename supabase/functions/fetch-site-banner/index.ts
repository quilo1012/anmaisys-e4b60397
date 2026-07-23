// Fetches https://appliednutrition.uk/ server-side (avoids browser CORS) and
// extracts the main banner: Open Graph image/title/description. The app polls this
// so whenever the site's banner (og:image) changes, the app's welcome updates too.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SITE = "https://appliednutrition.uk/";

function meta(html: string, key: string): string | null {
  // property/name="key" ... content="value"  (and the reversed order)
  const a = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']+)["']`, "i"));
  if (a?.[1]) return a[1];
  const b = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${key}["']`, "i"));
  return b?.[1] ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const res = await fetch(SITE, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ANSystem/1.0)", Accept: "text/html" },
    });
    const html = await res.text();

    const image = meta(html, "og:image") || meta(html, "twitter:image");
    const title = meta(html, "og:title") || "Applied Nutrition";
    const description = meta(html, "og:description") || "";

    return new Response(
      JSON.stringify({ image, title, description, url: SITE }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          // Cache at the edge for 10 min so we don't hammer the site, but still refresh.
          "Cache-Control": "public, max-age=600",
        },
      },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
