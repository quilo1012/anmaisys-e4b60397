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
  /** Optional live site banner slides (device-resolved URLs) shown behind the navy overlay. */
  backgroundImages?: string[];
}

/**
 * Shared visual shell for every authentication surface (Login, OAuth Consent,
 * password reset). Premium navy background with a centered white card and
 * navy brand chip. Always light-themed — never follows the app's dark mode.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  maxWidthClass = "max-w-[440px]",
  backgroundImages,
}: AuthShellProps) {
  const year = new Date().getFullYear();
  const hasBanner = (backgroundImages?.length ?? 0) > 0;
  // With a live site banner, the navy layers become a translucent overlay so the
  // image reads through; without one, they stay fully opaque (the original look).
  const overlay = hasBanner
    ? [
        "radial-gradient(ellipse 90% 60% at 50% 0%, rgba(59,130,246,0.28) 0%, rgba(23,37,84,0) 60%)",
        "linear-gradient(180deg, rgba(30,58,138,0.82) 0%, rgba(23,37,84,0.90) 100%)",
      ].join(", ")
    : [
        "radial-gradient(ellipse 90% 60% at 50% 0%, rgba(59,130,246,0.22) 0%, rgba(23,37,84,0) 60%)",
        "radial-gradient(ellipse 120% 100% at 50% 100%, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 55%)",
        "linear-gradient(180deg, #1E3A8A 0%, #172554 100%)",
      ].join(", ");
  return (
    <div
      className="relative flex min-h-screen w-full items-center justify-center overflow-hidden px-4 py-10 sm:px-6"
      style={{ backgroundColor: "#172554" }}
    >
      {hasBanner && <SiteBannerImages urls={backgroundImages!} />}
      <div className="absolute inset-0" style={{ backgroundImage: overlay }} aria-hidden="true" />
      <div
        className={`relative z-10 w-full ${maxWidthClass} motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-500`}
      >
        <div className="rounded-2xl bg-white px-8 py-9 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.45),0_8px_20px_-8px_rgba(0,0,0,0.25)] ring-1 ring-slate-200/80 sm:px-10 sm:py-10">
          {/* Official brand logo chip */}
          <div className="mb-7 flex justify-center">
            <div className="rounded-xl bg-[#1E3A8A] p-2.5 shadow-[0_6px_16px_-6px_rgba(30,58,138,0.5)]">
              <div className="overflow-hidden rounded-lg">
                <img
                  src={appliedLogo}
                  alt=""
                  aria-hidden="true"
                  className="block h-11 w-auto max-w-[220px] object-contain"
                />
              </div>
            </div>
          </div>

          {/* Title */}
          <div className="mb-7 text-center">
            <h1 className="text-[26px] font-bold leading-tight tracking-tight text-[#1E3A8A]">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-2 text-sm leading-relaxed text-slate-500">
                {subtitle}
              </p>
            )}
          </div>

          {children}
        </div>

        <div className="mt-5 space-y-1 text-center">
          <p className="text-[11px] font-medium tracking-wide text-white/70">
            Encrypted connection · Audited access
          </p>
          <p className="text-[11px] text-white/40">
            © {year} Applied Nutrition
          </p>
        </div>
      </div>
    </div>
  );
}
