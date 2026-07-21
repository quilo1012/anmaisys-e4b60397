import { ReactNode } from "react";
import appliedLogoWhite from "@/assets/applied-nutrition-white.png";


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
}

/**
 * Shared visual shell for every authentication surface (Login, OAuth Consent,
 * password reset). Simple, light, centered card with a navy brand header.
 * Login is always light-themed — it never follows the app's dark mode.
 */
export function AuthShell({
  brandIconUrl,
  badge,
  title,
  subtitle,
  children,
  maxWidthClass = "max-w-[460px]",
}: AuthShellProps) {
  return (
    <div
      className="flex min-h-screen w-full items-center justify-center px-4 py-8 sm:px-6"
      style={{
        backgroundColor: "#1E3A8A",
        backgroundImage:
          "radial-gradient(ellipse at center, rgba(59,130,246,0.25) 0%, rgba(30,58,138,0) 60%), linear-gradient(180deg, #1E3A8A 0%, #172554 100%)",
      }}
    >
      <div className={`w-full ${maxWidthClass} motion-safe:animate-scale-in`}>
        <div className="rounded-2xl bg-white px-8 py-10 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.5)] ring-1 ring-slate-200 sm:px-10">
          {/* Navy brand chip with white logo */}
          <div className="mb-6 flex justify-center">
            <div className="rounded-xl bg-[#1E3A8A] px-6 py-4 shadow-sm">
              <img
                src={brandIconUrl ?? appliedLogo}
                alt=""
                aria-hidden="true"
                className="h-10 w-auto object-contain brightness-0 invert"
              />
            </div>
          </div>

          {/* Title */}
          <div className="mb-6 text-center">
            <div className="flex items-center justify-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-[#1E3A8A]">
                {title}
              </h1>
              {badge}
            </div>
            {subtitle && (
              <p className="mt-1.5 text-sm text-slate-500">{subtitle}</p>
            )}
          </div>

          {children}
        </div>

        <p className="mt-4 text-center text-[11px] text-white/60">
          Encrypted connection · Audited access
        </p>
      </div>
    </div>
  );
}

