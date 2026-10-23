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
    <div className="flex min-h-[100dvh] w-full flex-col overflow-x-hidden bg-auth-paper lg:grid lg:grid-cols-[minmax(0,44%)_minmax(0,56%)]">
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

      {/* ── Marca em ecrã estreito ──────────────────────────────────
          Sem faixa nem capa. A faixa azul de 58px e, depois, a capa com grelha eram
          decoração por cima de um formulário que é tudo o que a página tem para
          fazer; num telemóvel empurravam o botão de entrar para baixo do teclado.
          Fica a marca numa linha, em papel, à mesma margem do formulário — e uma
          aresta de 3px no azul da casa, a única cor antes do botão. */}
      <header
        className="relative flex items-center gap-3 px-6 pb-1.5 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-10 lg:hidden"
      >
        {/* A aresta da casa, agora com direcção em vez de um azul chapado: do azul
            profundo da placa à esquerda até ao azul claro do campo à direita — as
            mesmas três paragens do gradiente que pinta a coluna da marca no
            computador, para que o telemóvel e o ecrã grande sejam a mesma casa. */}
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-[3px]"
          style={{
            backgroundImage:
              "linear-gradient(90deg, hsl(var(--auth-panel-deep)) 0%, hsl(var(--auth-field)) 55%, hsl(var(--auth-field-top)) 100%)",
          }}
        />

        {/* Uma chapa de máquina, que é como a fábrica identifica o que tem à frente:
            o átomo gravado numa placa, com um anel fino e uma sombra curta a dar-lhe
            espessura. O ficheiro já traz o seu próprio azul, por isso a placa é o
            próprio ícone — não mais uma caixa à volta de uma caixa.

            36px em vez de 32, e o espaço de baixo encolhe os mesmos 4px: a linha
            cresce para o olho e não cresce para o teclado. Essa é a restrição que
            manda aqui — a faixa e a capa que aqui estiveram foram removidas porque
            empurravam o botão de entrar para debaixo do teclado, e nada do que se
            acrescente a este cabeçalho pode voltar a fazê-lo. */}
        <img
          src="/android-chrome-192x192.png"
          alt=""
          className="h-9 w-9 select-none rounded-[10px] shadow-sm ring-1 ring-auth-brand/20"
        />
        <span className="shrink-0 font-display text-base font-bold tracking-[-0.01em] text-auth-ink">PMSystem</span>

        {/* Quem faz a máquina, onde a chapa o diz: a seguir ao nome, depois de uma
            régua, e não solto no canto oposto.

            `min-w-0` + `truncate`: num ecrã de 320px esta linha mede cerca de 295px, o
            que cabe — mas cabe por 25px, e a largura real depende da Archivo ter
            chegado ou de estar a ser substituída por uma face mais larga. O nome do
            sistema e o ícone não encolhem; se faltar espaço é este texto que cede.
            A linha nunca empurra a página para o lado, que é o que
            `e2e/login-responsive.spec.ts` mede a 320, 375, 390 e 430. */}
        <span className="ml-auto flex min-w-0 items-center gap-3">
          <span aria-hidden="true" className="h-4 w-px shrink-0 bg-auth-line" />
          <span className="truncate text-xs text-auth-ink-muted">Applied Nutrition</span>
        </span>
      </header>

      {/* ── Formulário ─────────────────────────────────────────────── */}
      {/* Num telemóvel o formulário começa em cima, não ao centro: centrado, o teclado
          que abre ao tocar no campo empurrava-o para fora e o ecrã saltava. */}
      {/* Sempre ancorado em cima, também no computador. Centrado, a coluna mudava de
          altura enquanto se escrevia — o QR dá lugar ao link quando o campo passa a
          ser um email — e o título "Sign in" saltava 130px a meio da escrita. */}
      <main className="flex flex-1 items-start justify-center px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-8 sm:px-10 sm:py-10 lg:pb-14 lg:pt-[max(3.5rem,14vh)]">
        <div
          className={`w-full ${maxWidthClass} motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-500`}
        >
          <div className="mb-7 sm:mb-8">
            {brandIconUrl && (
              <img
                src={brandIconUrl}
                alt=""
                className="mb-4 h-9 w-9 rounded-md object-contain sm:mb-5 sm:h-10 sm:w-10"
              />
            )}
            <h1 className="font-display text-[28px] font-bold leading-[1.1] tracking-[-0.02em] text-auth-ink sm:text-3xl">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-2 text-[15px] leading-relaxed text-auth-ink-muted sm:text-sm">{subtitle}</p>
            )}
            {badge && <div className="mt-4">{badge}</div>}
          </div>

          {children}

          <p className="mt-10 flex items-start gap-2 border-t border-auth-line pt-4 text-xs leading-relaxed text-auth-ink-muted lg:hidden">
            <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Encrypted connection, access by role, every action audited. © {year} Applied Nutrition</span>
          </p>
        </div>
      </main>
    </div>
  );
}
