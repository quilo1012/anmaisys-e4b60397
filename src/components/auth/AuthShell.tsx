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
  /** Optional maximum width override for the form column content. */
  maxWidthClass?: string;
  /** Optional live site banner slides (device-resolved URLs). When present,
   *  renders a professional split-screen layout with banner on the left. */
  backgroundImages?: string[];
}

/**
 * Shared visual shell for every authentication surface (Login, OAuth Consent,
 * SignUp, password reset). Always light-themed — never follows the app's dark
 * mode. Two modes:
 *   - hasBanner: enterprise split-screen (banner left, white form right).
 *   - no banner: centered white card on the navy background.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  maxWidthClass = "max-w-[420px]",
  backgroundImages,
}: AuthShellProps) {
  const year = new Date().getFullYear();
  const hasBanner = (backgroundImages?.length ?? 0) > 0;

  const LogoHeader = (
    <div className="mb-7 overflow-hidden rounded-xl ring-1 ring-slate-200/80 shadow-sm">
      <img
        src={appliedLogo}
        alt="Applied Nutrition"
        className="block h-20 w-full object-contain bg-white"
      />
    </div>
  );

  const FormPanel = (
    <div
      className={`w-full ${maxWidthClass} motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-500`}
    >
      {LogoHeader}
      <div className="mb-6 text-center md:text-left">
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
  );

  if (hasBanner) {
    return (
      <div className="flex min-h-screen w-full flex-col bg-white md:flex-row">
        {/* LEFT: banner panel */}
        <div className="relative h-[36vh] w-full overflow-hidden md:h-screen md:w-[55%]">
          <div className="absolute inset-0" style={{ backgroundColor: "#172554" }} aria-hidden="true" />
          <SiteBannerImages urls={backgroundImages!} fit="cover" />
          {/* Bottom scrim for legible caption */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(180deg, rgba(23,37,84,0) 55%, rgba(23,37,84,0.75) 100%)",
            }}
            aria-hidden="true"
          />
          <div className="absolute inset-x-0 bottom-0 hidden md:block px-8 pb-6">
            <p className="text-[11px] font-medium tracking-wide text-white/85">
              Encrypted connection · Audited access
            </p>
            <p className="text-[11px] text-white/60">© {year} Applied Nutrition</p>
          </div>
        </div>

        {/* RIGHT: form panel */}
        <div className="relative flex flex-1 items-center justify-center bg-white px-5 py-8 sm:px-10 md:py-10">
          {FormPanel}
          {/* Mobile footer under the form */}
          <div className="pointer-events-none absolute inset-x-0 bottom-2 flex flex-col items-center gap-0.5 md:hidden">
            <p className="text-[10px] font-medium tracking-wide text-slate-500">
              Encrypted connection · Audited access
            </p>
            <p className="text-[10px] text-slate-400">© {year} Applied Nutrition</p>
          </div>
        </div>
      </div>
    );
  }

  // No banner — clean centered card on navy background.
  const overlay = [
    "radial-gradient(ellipse 90% 60% at 50% 0%, rgba(59,130,246,0.22) 0%, rgba(23,37,84,0) 60%)",
    "radial-gradient(ellipse 120% 100% at 50% 100%, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 55%)",
    "linear-gradient(180deg, #1E3A8A 0%, #172554 100%)",
  ].join(", ");
  return (
    <div
      className="relative flex min-h-screen w-full items-center justify-center overflow-hidden px-4 py-10 sm:px-6"
      style={{ backgroundColor: "#172554" }}
    >
      <div className="absolute inset-0" style={{ backgroundImage: overlay }} aria-hidden="true" />
      <div
        className={`relative z-10 w-full ${maxWidthClass} motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-500`}
      >
        <div className="rounded-2xl bg-white px-8 py-9 sm:px-10 sm:py-10 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.45),0_8px_20px_-8px_rgba(0,0,0,0.25)] ring-1 ring-slate-200/80">
          {LogoHeader}
          <div className="mb-6 text-center">
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
          <p className="text-[11px] text-white/40">© {year} Applied Nutrition</p>
        </div>
      </div>
    </div>
  );
}
