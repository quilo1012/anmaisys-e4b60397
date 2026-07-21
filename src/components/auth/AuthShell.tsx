import { ReactNode } from "react";
import { ShieldCheck, Activity, Boxes, LineChart } from "lucide-react";

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
 * password reset, etc.). On desktop (lg+) renders a split-screen with a brand
 * panel on the left and the form on the right. On mobile/tablet falls back to
 * the original single centered card. Presentation-only — no auth logic here.
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
    <div className="relative min-h-screen w-full bg-[hsl(222_47%_6%)] text-white lg:flex">
      {/* ============ LEFT BRAND PANEL (desktop only) ============ */}
      <aside className="relative hidden overflow-hidden lg:flex lg:w-[54%] lg:flex-col lg:justify-between lg:p-12 xl:p-16">
        {/* Base gradient */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(70% 55% at 25% 20%, hsl(214 90% 30% / 0.75) 0%, transparent 65%)," +
              "radial-gradient(60% 50% at 85% 90%, hsl(214 90% 20% / 0.55) 0%, transparent 70%)," +
              "linear-gradient(140deg, #1E3A8A 0%, hsl(222 60% 10%) 55%, hsl(222 55% 5%) 100%)",
          }}
        />
        {/* Mesh grid */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage:
              "linear-gradient(hsl(0 0% 100% / 0.7) 1px, transparent 1px), linear-gradient(90deg, hsl(0 0% 100% / 0.7) 1px, transparent 1px)",
            backgroundSize: "64px 64px",
            maskImage: "radial-gradient(ellipse at 30% 40%, black 30%, transparent 85%)",
          }}
        />
        {/* Radial glow */}
        <div className="pointer-events-none absolute -left-32 top-1/3 h-[520px] w-[520px] rounded-full bg-[hsl(214_100%_55%)] opacity-25 blur-[160px]" />
        {/* Vignette */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_60%,hsl(222_60%_3%/0.75)_100%)]" />

        {/* Header: logo */}
        <div className="relative z-10 flex items-center gap-3">
          <img
            src={brandIconUrl}
            alt=""
            aria-hidden="true"
            className="h-11 w-11 shrink-0 rounded-xl object-contain ring-1 ring-white/15"
          />
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold tracking-tight text-white">Applied Nutrition</span>
            <span className="text-[11px] uppercase tracking-[0.18em] text-white/50">Industrial Ops</span>
          </div>
        </div>

        {/* Hero copy + features */}
        <div className="relative z-10 max-w-xl">
          <h2 className="text-4xl font-semibold leading-[1.05] tracking-tight text-white xl:text-5xl">
            AN Maintenance
          </h2>
          <p className="mt-4 text-base text-white/70 xl:text-lg">
            Industrial Maintenance &amp; Production Platform — one control room for every line, part and shift.
          </p>

          <ul className="mt-10 space-y-5">
            {[
              { icon: Activity, title: "Real-time work orders", desc: "Track breakdowns, SLAs and engineers live across every line." },
              { icon: Boxes, title: "Automated parts control", desc: "FIFO inventory with auto-deduction on every repair." },
              { icon: LineChart, title: "Production, downtime & KPIs", desc: "OEE, MTTR, MTBF and RAG reports in one place." },
            ].map(({ icon: Icon, title: t, desc }) => (
              <li key={t} className="flex items-start gap-4">
                <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] text-[hsl(214_100%_70%)] backdrop-blur">
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white">{t}</p>
                  <p className="mt-0.5 text-xs text-white/55">{desc}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Footer: trust line */}
        <div className="relative z-10 flex flex-col gap-2 text-[11px] text-white/45">
          <div className="inline-flex items-center gap-2">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-300/80" />
            <span>Encrypted connection · Audited access</span>
          </div>
          <span>© {year} Applied Nutrition Ltd. · Maintenance Platform v1.0</span>
        </div>
      </aside>

      {/* ============ RIGHT FORM PANEL ============ */}
      <section className="relative flex min-h-screen flex-1 items-center justify-center overflow-hidden px-3 py-6 sm:px-6 sm:py-10 lg:px-10">
        {/* Mobile/tablet background (only visible when left panel is hidden) */}
        <div
          className="pointer-events-none absolute inset-0 lg:hidden"
          style={{
            background:
              "radial-gradient(60% 50% at 18% 25%, hsl(214 90% 22% / 0.55) 0%, transparent 60%)," +
              "radial-gradient(50% 45% at 85% 80%, hsl(38 92% 45% / 0.18) 0%, transparent 65%)," +
              "radial-gradient(80% 60% at 50% 100%, hsl(214 80% 14% / 0.6) 0%, transparent 70%)," +
              "linear-gradient(180deg, hsl(222 47% 7%) 0%, hsl(222 50% 5%) 100%)",
          }}
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.05] lg:hidden"
          style={{
            backgroundImage:
              "linear-gradient(hsl(0 0% 100% / 0.6) 1px, transparent 1px), linear-gradient(90deg, hsl(0 0% 100% / 0.6) 1px, transparent 1px)",
            backgroundSize: "56px 56px",
            maskImage: "radial-gradient(ellipse at center, black 40%, transparent 80%)",
          }}
        />
        {/* Desktop subtle background so the right side doesn't feel flat */}
        <div className="pointer-events-none absolute inset-0 hidden lg:block">
          <div className="absolute right-[-10%] top-[-10%] h-[420px] w-[420px] rounded-full bg-[hsl(214_100%_50%)] opacity-[0.08] blur-[140px]" />
        </div>

        <div className={`relative z-10 w-full ${maxWidthClass}`}>
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-[hsl(222_47%_8%)]/85 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.75)] backdrop-blur-2xl">
            {/* Brand header strip — full on mobile, compact on desktop */}
            <div className="flex items-center gap-2 border-b border-white/10 bg-white/[0.02] px-3 py-3 sm:gap-3 sm:px-6 sm:py-4">
              <img
                src={brandIconUrl}
                alt=""
                aria-hidden="true"
                className="h-9 w-9 shrink-0 rounded-lg object-contain ring-1 ring-white/10 sm:h-10 sm:w-10 lg:hidden"
              />
              <div className="flex min-w-0 flex-1 flex-col leading-tight lg:hidden">
                <span className="truncate text-[13px] font-semibold tracking-tight text-white">Applied Nutrition</span>
                <span className="truncate text-[11px] text-white/50">Maintenance Platform</span>
              </div>
              <span className="hidden text-[11px] font-medium uppercase tracking-[0.18em] text-white/45 lg:inline">
                Sign in
              </span>
              <div className="ml-auto flex items-center gap-2">
                {badge}
                <span className="hidden shrink-0 items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/[0.08] px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-emerald-300/90 sm:inline-flex">
                  <ShieldCheck className="h-3 w-3" /> Secure
                </span>
              </div>
            </div>

            <div className="px-4 pb-6 pt-5 sm:px-8 sm:pb-8 sm:pt-7">
              <div className="mb-5 sm:mb-6">
                <h1 className="text-xl font-semibold tracking-tight text-white sm:text-[22px]">{title}</h1>
                {subtitle && <p className="mt-1 text-xs text-white/50">{subtitle}</p>}
              </div>
              {children}
            </div>
          </div>

          <p className="mt-6 text-center text-[11px] text-white/35 lg:hidden">
            © {year} Applied Nutrition Ltd. · Maintenance Platform v1.0
          </p>
        </div>
      </section>
    </div>
  );
}
