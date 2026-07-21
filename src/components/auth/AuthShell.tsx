import { ReactNode } from "react";
import appliedLogo from "@/assets/applied-nutrition-logo-v3.png.asset.json";

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
  const logoSrc = brandIconUrl ?? appliedLogo.url;

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-[#F3F4F6] px-4 py-8 sm:px-6">
      <div className={`w-full ${maxWidthClass} motion-safe:animate-scale-in`}>
        <div className="overflow-hidden rounded-2xl bg-white shadow-[0_10px_40px_-15px_rgba(15,23,42,0.15)] ring-1 ring-slate-200">
          {/* Navy brand header */}
          <div className="flex items-center justify-center bg-[#1E3A8A] px-8 py-10">
            <img
              src={logoSrc}
              alt="Applied Nutrition"
              className="h-10 w-auto object-contain brightness-0 invert"
            />
          </div>

          {/* Body */}
          <div className="px-8 py-8 sm:py-10">
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
        </div>

        <p className="mt-4 text-center text-[11px] text-slate-400">
          Encrypted connection · Audited access
        </p>
      </div>
    </div>
  );
}
