import { ReactNode } from "react";
import { ShieldCheck, Activity, Wrench, Gauge } from "lucide-react";
import appliedLogo from "@/assets/applied-nutrition-logo-v3.png.asset.json";
import industrialBg from "@/assets/login-industrial-bg.jpg";

interface AuthShellProps {
  /** Optional override for the header brand image. */
  brandIconUrl?: string;
  /** Right-side mode badge (Staff/Tablet chip on Login). Optional. */
  badge?: ReactNode;
  /** Card title. */
  title: string;
  /** Card subtitle. */
  subtitle?: string;
  /** Card body. */
  children: ReactNode;
  /** Optional maximum width override for the right-side form card. */
  maxWidthClass?: string;
}

const highlights = [
  {
    icon: Activity,
    title: "Real-time control",
    body: "Live line status, downtime and SLA across the factory floor.",
  },
  {
    icon: Wrench,
    title: "Maintenance workflow",
    body: "From request to sign-off — engineers, parts and history in one place.",
  },
  {
    icon: Gauge,
    title: "Reliability insights",
    body: "MTTR, MTBF and RAG performance to keep production flowing.",
  },
];

/**
 * Shared visual shell for every authentication surface (Login, OAuth Consent,
 * password reset, etc.).
 *
 * Layout:
 *  - `lg+`  → premium split-screen: rich brand panel on the left,
 *             glass form card on the right.
 *  - `<lg`  → single centered card (brand header + form body) so tablets
 *             and phones keep the compact, familiar layout.
 *
 * Presentation-only — no auth logic here.
 */
export function AuthShell({
  brandIconUrl,
  badge,
  title,
  subtitle,
  children,
  maxWidthClass = "max-w-[440px]",
}: AuthShellProps) {
  const logoSrc = brandIconUrl ?? appliedLogo.url;
  const year = new Date().getFullYear();

  return (
    <div className="relative flex min-h-screen w-full bg-background">
      {/* ─────────── Left brand panel (desktop only) ─────────── */}
      <aside
        aria-hidden="true"
        className="relative hidden overflow-hidden lg:flex lg:w-1/2 xl:w-[55%] motion-safe:animate-fade-in"
      >
        {/* Industrial photo — decorative, muted so text stays readable */}
        <img
          src={industrialBg}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-[0.18]"
        />
        {/* Deep navy wash for AA contrast */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(135deg, rgba(15,23,42,0.92) 0%, rgba(30,58,138,0.88) 55%, rgba(30,64,175,0.82) 100%)",
          }}
        />
        {/* Subtle vignette + grid texture */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(59,130,246,0.25),transparent_60%)]" />
        <div
          className="absolute inset-0 opacity-[0.08] mix-blend-overlay"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />

        {/* Content */}
        <div className="relative z-10 flex w-full flex-col justify-between px-12 py-14 text-white xl:px-16">
          {/* Top: logo + brand */}
          <div>
            <div className="inline-flex items-center rounded-2xl bg-white/95 px-5 py-3 shadow-lg shadow-black/20 ring-1 ring-white/40">
              <img
                src={logoSrc}
                alt="Applied Nutrition"
                className="h-9 w-auto object-contain"
              />
            </div>

            <div className="mt-12 max-w-lg">
              <h2 className="text-4xl font-semibold leading-tight tracking-tight xl:text-5xl">
                AN Maintenance
              </h2>
              <p className="mt-4 text-base leading-relaxed text-white/75 xl:text-lg">
                The operational backbone of Applied Nutrition — connecting
                operators, engineers and management in one reliable platform.
              </p>
            </div>

            {/* Feature highlights as glass chips */}
            <ul className="mt-10 space-y-4 max-w-lg">
              {highlights.map(({ icon: Icon, title: t, body }) => (
                <li
                  key={t}
                  className="group flex items-start gap-4 rounded-2xl border border-white/10 bg-white/[0.06] p-4 backdrop-blur-sm transition-colors hover:bg-white/[0.09]"
                >
                  <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">
                    <Icon className="h-5 w-5 text-sky-200" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white">{t}</p>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-white/65">
                      {body}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Bottom: status + trust line */}
          <div className="mt-12 space-y-3">
            <div className="inline-flex items-center gap-2.5 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3.5 py-1.5 text-[12px] font-medium text-emerald-200">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              System operational
            </div>
            <div className="flex items-center gap-2 text-[12px] text-white/55">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-300/80" />
              <span>Encrypted connection · Audited access</span>
            </div>
            <p className="text-[11px] text-white/40">
              © {year} Applied Nutrition. All rights reserved.
            </p>
          </div>
        </div>
      </aside>

      {/* ─────────── Right form panel ─────────── */}
      <main className="relative flex w-full flex-1 items-center justify-center px-4 py-8 sm:px-6 lg:w-1/2 xl:w-[45%]">
        {/* Soft ambient glow behind the card on desktop */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 hidden lg:block"
          style={{
            background:
              "radial-gradient(ellipse at center, hsl(var(--primary) / 0.08) 0%, transparent 60%)",
          }}
        />

        <div className={`relative w-full ${maxWidthClass} motion-safe:animate-scale-in`}>
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-primary/5 ring-1 ring-black/5">
            {/* Compact brand header — visible only when the left panel is hidden */}
            <div className="flex items-center justify-center border-b border-border bg-white px-8 py-6 lg:hidden">
              <img
                src={logoSrc}
                alt="Applied Nutrition"
                className="h-11 w-auto object-contain"
              />
            </div>

            {/* Body */}
            <div className="px-6 py-8 sm:px-8 sm:py-10">
              <div className="mb-7 text-center lg:text-left">
                <div className="flex items-center justify-center gap-2 lg:justify-start">
                  <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[27px]">
                    {title}
                  </h1>
                  {badge}
                </div>
                {subtitle && (
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    {subtitle}
                  </p>
                )}
              </div>
              {children}
            </div>
          </div>

          {/* Trust footer for mobile / tablet (desktop has it in the left panel) */}
          <div className="mt-5 flex items-center justify-center gap-2 text-[11px] text-muted-foreground lg:hidden">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500/80" />
            <span>Encrypted connection · Audited access</span>
          </div>
        </div>
      </main>
    </div>
  );
}
