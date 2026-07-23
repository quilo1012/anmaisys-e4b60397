import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { DeviceType } from "@/hooks/use-device-type";

export interface BannerSlide {
  desktop: string;
  mobile: string;
}

export interface SiteBanner {
  /** Primary single image (back-compat). */
  image: string | null;
  /** Full hero carousel: one entry per site slide, each with a desktop + mobile artwork. */
  images: BannerSlide[];
  title: string;
  description: string;
  url: string;
}

/**
 * Live banner scraped from appliednutrition.uk. A DB cron (refresh_site_banner)
 * re-scrapes the site's two-slide hero carousel every 30 min, so the app tracks
 * the site. Readable both signed-in (welcome home) and anonymously (login screen),
 * so the query is safe to run before auth — it just returns empty if blocked.
 */
export function useSiteBanner() {
  return useQuery<SiteBanner>({
    queryKey: ["site-banner"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("site_banner")
        .select("image, images, title, description")
        .eq("id", true)
        .maybeSingle();
      const raw = Array.isArray(data?.images) ? data.images : [];
      const images: BannerSlide[] = raw
        .map((s: any) => ({ desktop: s?.desktop ?? s?.mobile ?? "", mobile: s?.mobile ?? s?.desktop ?? "" }))
        .filter((s: BannerSlide) => s.desktop || s.mobile);
      return {
        image: data?.image ?? null,
        images,
        title: data?.title ?? "Applied Nutrition",
        description: data?.description ?? "",
        url: "https://appliednutrition.uk/",
      } as SiteBanner;
    },
    staleTime: 10 * 60_000,
  });
}

/** Resolve a banner's slides to a plain URL list for the given device (mobile → mobile art). */
export function bannerUrlsForDevice(banner: SiteBanner | undefined, device: DeviceType): string[] {
  if (!banner) return [];
  const urls = banner.images.map((s) => (device === "mobile" ? s.mobile : s.desktop)).filter(Boolean);
  if (urls.length) return urls;
  return banner.image ? [banner.image] : [];
}
