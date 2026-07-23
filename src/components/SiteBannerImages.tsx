import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Full-bleed rotating banner layer. Renders the given image URLs stacked and
 * cross-fades between them (matching the site's hero carousel). Meant to sit as
 * an absolute background behind an overlay + content, so it takes no layout space.
 */
export function SiteBannerImages({
  urls,
  intervalMs = 6000,
  fit = "cover",
  imgClassName,
}: {
  urls: string[];
  intervalMs?: number;
  /** "cover" fills & crops (bands); "contain" shows the whole image (no crop). */
  fit?: "cover" | "contain";
  /** Extra classes on each image (e.g. blur/scale for a backdrop-fill layer). */
  imgClassName?: string;
}) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
    if (urls.length <= 1) return;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const t = window.setInterval(() => setIndex((i) => (i + 1) % urls.length), intervalMs);
    return () => window.clearInterval(t);
  }, [urls.length, intervalMs]);

  if (urls.length === 0) return null;

  return (
    <>
      {urls.map((u, i) => (
        <img
          key={u}
          src={u}
          alt=""
          aria-hidden="true"
          loading={i === 0 ? "eager" : "lazy"}
          className={cn(
            "absolute inset-0 h-full w-full transition-opacity duration-1000",
            fit === "contain" ? "object-contain" : "object-cover",
            i === index ? "opacity-100" : "opacity-0",
            imgClassName,
          )}
        />
      ))}
    </>
  );
}
