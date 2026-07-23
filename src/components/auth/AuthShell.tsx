import { ReactNode } from "react";
import appliedLogo from "@/assets/appliedlogo.jpeg";
import { SiteBannerImages } from "@/components/SiteBannerImages";

interface AuthShellProps {
  /** Optional override for the header brand image. */
  brandIconUrl?: string;
  /** Optional badge (e.g. Staff/Tablet chip). Rendered next to the title. */
  badge?: ReactNode;
  /** Card title (e.g. "Welcome"). */
  title: string;
  /** Card subtitle. */
  subtitle?: string;
  /** Card body. */
  children: ReactNode;
  /** Optional maximum width override for the card. */
  maxWidthClass?: string;
  /** Live site banner slides (device-resolved URLs) shown full-bleed behind the card. */
  backgroundImages?: string[];
}

/**
 * Shared visual shell for every authentication surface (Login, OAuth Consent,
 * password reset). The live site banner fills the page behind a clean white card
 * with a navy header band carrying the brand logo. Always light card themed.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  maxWidthClass = "max-w-md",
  backgroundImages,
}: AuthShellProps) {
  const year = new Date().getFullYear();
  const hasBanner = (backgroundImages?.length ?? 0) > 0;
  return (
    <div
      className="relative flex min-h-screen w-full items-center justify-center overflow-hidden p-4 md:justify-end md:pr-[7vw] lg:pr-[9vw]"
      style={{ backgroundColor: "#172554" }}
    >
      {hasBanner ? (
        <>
          {/* Blurred, zoomed copy fills the letterbox; sharp banner on top. No dark veil. */}
          <SiteBannerImages urls={backgroundImages!} fit="cover" imgClassName="scale-110 blur-2xl" />
          <SiteBannerImages urls={backgroundImages!} fit="contain" />
        </>
      ) : (
        <div
          className="absolute inset-0"
          aria-hidden="true"
          style={{ backgroundImage: "linear-gradient(180deg, #1E3A8A 0%, #172554 100%)" }}
        />
      )}

      {/* Login card — translucent glass so the banner reads through it and dominates. */}
      <div
        className={`relative z-10 w-full ${maxWidthClass} overflow-hidden rounded-3xl bg-white/45 shadow-[0_30px_70px_-15px_rgba(0,0,0,0.6)] ring-1 ring-white/50 backdrop-blur-2xl motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-500`}
      >
        {/* Navy header band with the brand logo (kept mostly opaque so the logo reads) */}
        <div className="flex justify-center bg-gradient-to-b from-[#1E3A8A]/95 to-[#1E3A8A]/80 px-8 py-7">
          <img src={appliedLogo} alt="Applied Nutrition" className="h-14 w-auto object-contain" />
        </div>

        {/* Body — title, subtitle, form */}
        <div className="space-y-6 px-8 py-8 sm:px-10">
          <div className="space-y-2 text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
            {subtitle && <p className="text-sm leading-relaxed text-slate-600">{subtitle}</p>}
          </div>

          {children}
        </div>

        {/* Slim footer */}
        <div className="border-t border-white/40 px-8 py-4 text-center">
          <p className="text-[11px] font-medium tracking-wide text-slate-600">
            Encrypted connection · Audited access · © {year} Applied Nutrition
          </p>
        </div>
      </div>
    </div>
  );
}
