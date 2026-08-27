import { ReactNode } from "react";
import brandMark from "@/assets/applied-nutrition-white.png";
import { SiteBannerImages } from "@/components/SiteBannerImages";

interface AuthShellProps {
  /** Optional override for the brand mark shown above the form (per-tablet branding). */
  brandIconUrl?: string;
  /** Optional badge (e.g. the Recovery chip). Rendered under the title. */
  badge?: ReactNode;
  /** Card title (e.g. "Sign in"). */
  title: string;
  /** Card subtitle. */
  subtitle?: string;
  /** Card body. */
  children: ReactNode;
  /** Optional maximum width override for the form column. */
  maxWidthClass?: string;
  /** Live site banner slides (device-resolved URLs) shown inside the brand panel. */
  backgroundImages?: string[];
}

/**
 * Shared visual shell for every authentication surface (Login, Sign-up, OAuth
 * consent, password reset).
 *
 * Duas colunas: a esquerda é a placa da marca — o mesmo azul-tinta da barra
 * lateral, para se entrar no sistema pela cor em que se vai trabalhar — e a
 * direita é papel branco opaco, onde vive o formulário.
 *
 * O cartão de vidro que aqui estava (`bg-white/45` + `backdrop-blur`) só fazia
 * sentido com o banner do site por trás, e nenhuma das quatro páginas passa
 * `backgroundImages`. Sem imagem por baixo, o desfoque não desfoca nada: dava um
 * cartão cinzento-lodo com texto a 3:1 de contraste. O banner, quando existe,
 * passa a preencher a placa da esquerda por trás de um véu azul — é lá que uma
 * fotografia pode viver sem levar legibilidade a ninguém.
 */
export function AuthShell({
  brandIconUrl,
  badge,
  title,
  subtitle,
  children,
  maxWidthClass = "max-w-md",
  backgroundImages,
}: AuthShellProps) {
  const year = new Date().getFullYear();
  const hasBanner = (backgroundImages?.length ?? 0) > 0;

  return (
    <div className="flex min-h-screen w-full flex-col bg-auth-paper lg:grid lg:grid-cols-[minmax(0,44%)_minmax(0,56%)]">
      {/* ── Placa da marca ─────────────────────────────────────────── */}
      <aside
        className="relative isolate hidden overflow-hidden lg:flex lg:flex-col lg:justify-between lg:px-14 lg:py-12"
        style={{
          backgroundImage:
            "linear-gradient(165deg, hsl(var(--auth-field-top)) 0%, hsl(var(--auth-field)) 52%, hsl(var(--auth-panel-deep)) 100%)",
        }}
      >
        {hasBanner && (
          <>
            <SiteBannerImages urls={backgroundImages!} fit="cover" />
            <div className="absolute inset-0 bg-auth-field/85" aria-hidden="true" />
          </>
        )}

        {/* Grelha de desenho técnico. 4% de opacidade: quem a vir, viu; quem não
            a vir, não perdeu nada. É o único ornamento da página. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.055]"
          style={{
            backgroundImage:
              "linear-gradient(hsl(0 0% 100%) 1px, transparent 1px), linear-gradient(90deg, hsl(0 0% 100%) 1px, transparent 1px)",
            backgroundSize: "56px 56px",
            maskImage: "radial-gradient(120% 80% at 20% 15%, black 0%, transparent 75%)",
            WebkitMaskImage: "radial-gradient(120% 80% at 20% 15%, black 0%, transparent 75%)",
          }}
        />

        <img
          src={brandMark}
          alt="Applied Nutrition"
          className="relative w-56 max-w-full select-none"
        />

        <div className="relative max-w-md">
          <p className="font-figure text-2xs uppercase tracking-[0.22em] text-white/55">
            Production management
          </p>
          <h2 className="mt-3 font-display text-5xl font-bold uppercase leading-none tracking-tight text-white">
            PMSystem
          </h2>
          <p className="mt-5 text-sm leading-relaxed text-white/70">
            Planning, lines, quality and stock in one system — from the shop floor
            to the office.
          </p>
        </div>

        {/* Placa de dados: as mesmas três garantias que estavam em emojis, na voz
            de utilidade da app em vez de em pictogramas. */}
        <dl className="relative flex flex-wrap gap-x-10 gap-y-4 border-t border-white/15 pt-6 font-figure text-2xs uppercase tracking-[0.14em]">
          {[
            ["Connection", "Encrypted"],
            ["Access", "Role-based"],
            ["Actions", "Audited"],
          ].map(([term, value]) => (
            <div key={term}>
              <dt className="text-white/40">{term}</dt>
              <dd className="mt-1 text-white/80">{value}</dd>
            </div>
          ))}
          <div className="ml-auto self-end text-white/35 normal-case tracking-normal">
            © {year} Applied Nutrition
          </div>
        </dl>
      </aside>

      {/* ── Faixa da marca em ecrã estreito ────────────────────────── */}
      <header
        className="flex items-center px-6 py-5 sm:px-8 lg:hidden"
        style={{
          backgroundImage:
            "linear-gradient(100deg, hsl(var(--auth-field-top)) 0%, hsl(var(--auth-field)) 100%)",
        }}
      >
        <img src={brandMark} alt="Applied Nutrition" className="w-36 select-none" />
        <span className="ml-auto font-figure text-2xs uppercase tracking-[0.18em] text-white/55">
          PMSystem
        </span>
      </header>

      {/* ── Formulário ─────────────────────────────────────────────── */}
      <main className="flex flex-1 items-center justify-center px-6 py-10 sm:px-10 lg:py-14">
        <div
          className={`w-full ${maxWidthClass} motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-500`}
        >
          <div className="mb-8">
            {brandIconUrl && (
              <img
                src={brandIconUrl}
                alt=""
                className="mb-5 h-10 w-10 rounded-md object-contain"
              />
            )}
            <h1 className="font-display text-3xl font-bold tracking-tight text-auth-ink">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-2 text-sm leading-relaxed text-auth-ink-muted">{subtitle}</p>
            )}
            {badge && <div className="mt-4">{badge}</div>}
          </div>

          {children}

          <p className="mt-10 border-t border-auth-line pt-5 font-figure text-2xs uppercase tracking-[0.14em] text-auth-ink-muted lg:hidden">
            Encrypted · Role-based access · Audited · © {year} Applied Nutrition
          </p>
        </div>
      </main>
    </div>
  );
}
