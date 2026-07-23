import { ReactNode } from "react";
import anLogoWhite from "@/assets/applied-nutrition-white.png";

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
  /** Accepted for back-compat; the login no longer renders a banner. */
  backgroundImages?: string[];
}

/**
 * Shared visual shell for every authentication surface (Login, OAuth Consent,
 * password reset). A clean centered white card with a navy header band carrying
 * the brand logo, over a light-grey page. Always light-themed — never follows the
 * app's dark mode.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  maxWidthClass = "max-w-md",
}: AuthShellProps) {
  const year = new Date().getFullYear();
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-slate-100 p-4">
      <div
        className={`w-full ${maxWidthClass} overflow-hidden rounded-2xl bg-white shadow-[0_20px_50px_-12px_rgba(15,23,42,0.25)] ring-1 ring-slate-200 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-500`}
      >
        {/* Navy header band with the complete brand logo */}
        <div className="flex justify-center bg-[#1E3A8A] px-8 py-9">
          <img src={anLogoWhite} alt="Applied Nutrition" className="h-16 w-auto object-contain" />
        </div>

        {/* Body — title, subtitle, form */}
        <div className="space-y-6 px-8 py-8 sm:px-10">
          <div className="space-y-2 text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
            {subtitle && <p className="text-sm leading-relaxed text-slate-500">{subtitle}</p>}
          </div>

          {children}
        </div>

        {/* Slim footer */}
        <div className="border-t border-slate-100 px-8 py-4 text-center">
          <p className="text-[11px] font-medium tracking-wide text-slate-400">
            Encrypted connection · Audited access · © {year} Applied Nutrition
          </p>
        </div>
      </div>
    </div>
  );
}
