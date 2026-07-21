import { ReactNode } from "react";
import { ShieldCheck } from "lucide-react";

interface AuthShellProps {
  /** Icon/logo shown in the brand strip (defaults to /favicon.png). */
  brandIconUrl?: string;
  /** Right-side mode badge (Staff/Tablet chip on Login). Optional. */
  badge?: ReactNode;
  /** Card title. */
  title: string;
  /** Card subtitle. */
  subtitle?: string;
  /** Card body. */
  children: ReactNode;
  /** Optional maximum width override. */
  maxWidthClass?: string;
}

/**
 * Shared visual shell for every authentication surface (Login, OAuth Consent,
 * password reset, etc.) so all access points share the same background, card
 * frame, brand header and footer. Presentation-only — no auth logic here.
 */
export function AuthShell({
  brandIconUrl = "/favicon.png",
  badge,
  title,
  subtitle,
  children,
  maxWidthClass = "max-w-[440px] sm:max-w-[480px]",
}: AuthShellProps) {
  const year = new Date().getFullYear();
  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[hsl(222_47%_6%)] text-white">
      {/* Cinematic background */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 50% at 18% 25%, hsl(214 90% 22% / 0.55) 0%, transparent 60%)," +
            "radial-gradient(50% 45% at 85% 80%, hsl(38 92% 45% / 0.18) 0%, transparent 65%)," +
            "radial-gradient(80% 60% at 50% 100%, hsl(214 80% 14% / 0.6) 0%, transparent 70%)," +
            "linear-gradient(180deg, hsl(222 47% 7%) 0%, hsl(222 50% 5%) 100%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "linear-gradient(hsl(0 0% 100% / 0.6) 1px, transparent 1px), linear-gradient(90deg, hsl(0 0% 100% / 0.6) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage: "radial-gradient(ellipse at center, black 40%, transparent 80%)",
        }}
      />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_70%,hsl(222_55%_4%/0.7)_100%)]" />

      <main className="relative z-10 flex min-h-[100svh] items-center justify-center px-3 py-4 sm:px-6 sm:py-8">
        <div className={`relative w-full ${maxWidthClass}`}>
          <div className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[260px] w-[260px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[hsl(214_100%_55%)] opacity-20 blur-[100px] sm:h-[460px] sm:w-[460px] sm:blur-[140px]" />

          <div className="overflow-hidden rounded-2xl border border-white/10 bg-[hsl(222_47%_8%)]/80 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.75)] backdrop-blur-2xl">
            {/* Brand header strip */}
            <div className="flex items-center gap-2 border-b border-white/10 bg-white/[0.02] px-3 py-3 sm:gap-3 sm:px-6 sm:py-4">
              <img
                src={brandIconUrl}
                alt=""
                aria-hidden="true"
                className="h-9 w-9 shrink-0 rounded-lg object-contain ring-1 ring-white/10 sm:h-10 sm:w-10"
              />
              <div className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate text-[13px] font-semibold tracking-tight text-white">Applied Nutrition</span>
                <span className="truncate text-[11px] text-white/50">Maintenance Platform</span>
              </div>
              {badge}
              <span className="hidden shrink-0 items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/[0.08] px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-emerald-300/90 sm:inline-flex">
                <ShieldCheck className="h-3 w-3" /> Secure
              </span>
            </div>

            <div className="px-4 pb-6 pt-5 sm:px-8 sm:pb-8 sm:pt-7">
              <div className="mb-5 sm:mb-6">
                <h1 className="text-xl font-semibold tracking-tight text-white sm:text-[22px]">{title}</h1>
                {subtitle && <p className="mt-1 text-xs text-white/50">{subtitle}</p>}
              </div>
              {children}
            </div>
          </div>

          <p className="mt-6 text-center text-[11px] text-white/35">
            © {year} Applied Nutrition Ltd. · Maintenance Platform v1.0
          </p>
        </div>
      </main>
    </div>
  );
}
