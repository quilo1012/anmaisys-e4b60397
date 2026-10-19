import { ReactNode } from "react";
import brandMark from "@/assets/applied-nutrition-white.png";
import { SiteBannerImages } from "@/components/SiteBannerImages";
import { ShieldCheck } from "lucide-react";

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
    <div className="flex min-h-[100dvh] w-full flex-col bg-auth-paper lg:grid lg:grid-cols-[minmax(0,44%)_minmax(0,56%)]">
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

        {/* O nome do sistema como se escreve, não em maiúsculas espaçadas com um
            rótulo por cima: era a moldura de modelo genérico, e a placa dizia
            "PRODUCTION MANAGEMENT / PMSYSTEM" a quem só queria saber onde estava. */}
        <div className="relative max-w-md">
          <h2 className="font-display text-4xl font-bold leading-[1.05] tracking-tight text-white xl:text-5xl">
            PMSystem
          </h2>
          <p className="mt-4 max-w-sm text-base leading-relaxed text-white/75">
            Planning, lines, quality and stock for the Applied Nutrition factory, from
            the shop floor to the office.
          </p>
        </div>

        {/* As três garantias em frases, na letra do resto da página. */}
        <div className="relative flex flex-wrap items-end gap-x-8 gap-y-3 border-t border-white/15 pt-6 text-sm text-white/70">
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            {["Encrypted connection", "Access by role", "Every action audited"].map((t) => (
              <li key={t} className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-white/45" aria-hidden="true" />
                {t}
              </li>
            ))}
          </ul>
          <p className="ml-auto text-xs text-white/40">© {year} Applied Nutrition</p>
        </div>
      </aside>

      {/* ── Faixa da marca em ecrã estreito ────────────────────────── */}
      {/* Baixa em todas as larguras: no Galaxy Tab A9 deitado (~600px de altura) a
          faixa de 98px empurrava o QR e o Create account para fora do ecrã. */}
      {/* Num telemóvel com altura (≥640px) a faixa cresce para uma capa: a marca, o
          nome do sistema e uma linha sobre ele, e o formulário sobe por cima dela numa
          folha de cantos redondos. Era uma tira de 58px com o logótipo a 96px e o resto
          do ecrã em branco por baixo do botão. O tablet deitado e o telemóvel deitado
          (pouca altura) ficam com a tira baixa — a razão do comentário acima mantém-se. */}
      <header
        className="relative isolate flex items-center overflow-hidden px-5 py-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] sm:px-8 lg:hidden [@media(max-width:639px)_and_(min-height:640px)]:flex-col [@media(max-width:639px)_and_(min-height:640px)]:items-start [@media(max-width:639px)_and_(min-height:640px)]:pb-10 [@media(max-width:639px)_and_(min-height:640px)]:pt-[max(1.75rem,env(safe-area-inset-top))]"
        style={{
          backgroundImage:
            "linear-gradient(160deg, hsl(var(--auth-field-top)) 0%, hsl(var(--auth-field)) 60%, hsl(var(--auth-panel-deep)) 100%)",
        }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 opacity-[0.05]"
          style={{
            backgroundImage:
              "linear-gradient(hsl(0 0% 100%) 1px, transparent 1px), linear-gradient(90deg, hsl(0 0% 100%) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
        <img src={brandMark} alt="Applied Nutrition" className="w-24 select-none sm:w-28 [@media(max-width:639px)_and_(min-height:640px)]:w-32" />
        <span className="ml-auto text-sm font-semibold text-white/75 [@media(max-width:639px)_and_(min-height:640px)]:hidden">PMSystem</span>
        <div className="hidden [@media(max-width:639px)_and_(min-height:640px)]:mt-6 [@media(max-width:639px)_and_(min-height:640px)]:block">
          <p className="font-display text-[26px] font-bold leading-none tracking-tight text-white">PMSystem</p>
          <p className="mt-2 max-w-[18rem] text-sm leading-snug text-white/70">
            Planning, lines, quality and stock for the Applied Nutrition factory.
          </p>
        </div>
      </header>

      {/* ── Formulário ─────────────────────────────────────────────── */}
      {/* Num telemóvel o formulário começa em cima, não ao centro: centrado, o teclado
          que abre ao tocar no campo empurrava-o para fora e o ecrã saltava. */}
      {/* Sempre ancorado em cima, também no computador. Centrado, a coluna mudava de
          altura enquanto se escrevia — o QR dá lugar ao link quando o campo passa a
          ser um email — e o título "Sign in" saltava 130px a meio da escrita. */}
      <main className="relative flex flex-1 items-start justify-center bg-auth-paper px-5 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-10 sm:py-8 lg:pb-14 lg:pt-[max(3.5rem,14vh)] [@media(max-width:639px)_and_(min-height:640px)]:-mt-5 [@media(max-width:639px)_and_(min-height:640px)]:rounded-t-[1.25rem] [@media(max-width:639px)_and_(min-height:640px)]:pt-7">
        <div
          className={`w-full ${maxWidthClass} motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-500`}
        >
          <div className="mb-5 sm:mb-8">
            {brandIconUrl && (
              <img
                src={brandIconUrl}
                alt=""
                className="mb-4 h-9 w-9 rounded-md object-contain sm:mb-5 sm:h-10 sm:w-10"
              />
            )}
            <h1 className="font-display text-2xl font-bold tracking-tight text-auth-ink sm:text-3xl">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-1.5 text-sm leading-relaxed text-auth-ink-muted sm:mt-2">{subtitle}</p>
            )}
            {badge && <div className="mt-4">{badge}</div>}
          </div>

          {children}

          <p className="mt-8 border-t border-auth-line pt-4 text-xs leading-relaxed text-auth-ink-muted lg:hidden">
            Encrypted connection, access by role, every action audited.
            <br />© {year} Applied Nutrition
          </p>
        </div>
      </main>
    </div>
  );
}
