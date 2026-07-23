import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface SiteBanner {
  image: string | null;
  title: string;
  description: string;
  url: string;
}

/**
 * Live banner scraped from appliednutrition.uk. A DB cron (refresh_site_banner)
 * re-scrapes the site's homepage hero every 30 min, so the app tracks the site.
 * Readable both signed-in (welcome home) and anonymously (login screen), so the
 * query is safe to run before auth — it simply returns a null image if blocked.
 */
export function useSiteBanner() {
  return useQuery<SiteBanner>({
    queryKey: ["site-banner"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("site_banner")
        .select("image, title, description")
        .eq("id", true)
        .maybeSingle();
      return {
        image: data?.image ?? null,
        title: data?.title ?? "Applied Nutrition",
        description: data?.description ?? "",
        url: "https://appliednutrition.uk/",
      } as SiteBanner;
    },
    staleTime: 10 * 60_000,
  });
}
