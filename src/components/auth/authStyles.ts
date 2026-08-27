/**
 * Receita única dos controlos das quatro superfícies de autenticação.
 *
 * Antes havia quatro: o login com `h-12`, o reset com `h-11` e fundo cinzento, o
 * signup com `py-2.5` e o consentimento com botões de `h-11`. Ninguém vê as quatro
 * ao mesmo tempo, mas vê-as em sequência — entrar, falhar, recuperar — e um campo
 * que muda de altura entre passos é o que faz um fluxo parecer remendado.
 *
 * O `bg` do botão primário fica de fora do `authBtnBase` de propósito: o botão de
 * entrar troca para verde quando a sessão abre, e essa é a única cor que o ecrã
 * pode mudar sob os pés de quem está a olhar.
 */

export const authLabel = "text-sm font-medium text-auth-ink";

const fieldBase =
  "h-12 w-full rounded-lg border border-auth-line bg-auth-paper text-sm text-auth-ink " +
  "transition-colors placeholder:text-auth-ink-muted/70 hover:border-auth-ink-muted/50 " +
  "focus:border-auth-brand focus:outline-none focus:ring-2 focus:ring-auth-brand/20";

/** Campo simples. */
export const authField = `${fieldBase} px-4`;
/** Campo com ícone à esquerda. */
export const authFieldIconed = `${fieldBase} pl-10 pr-4`;
/** Campo com ícone à esquerda e botão à direita (o olho do password). */
export const authFieldIconedAction = `${fieldBase} pl-10 pr-11`;
/** Campo sem ícone mas com botão à direita. */
export const authFieldAction = `${fieldBase} px-4 pr-11`;
/** `<select>`: a seta nativa sai com `appearance-none`, o chevron entra desenhado. */
export const authSelect = `${fieldBase} appearance-none pl-10 pr-9`;

/** Ícone decorativo encostado à esquerda de um campo `relative`. */
export const authIcon =
  "pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-auth-ink-muted";
/** Botão encostado à direita de um campo `relative`. */
export const authInlineBtn =
  "absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-auth-ink-muted " +
  "transition-colors hover:text-auth-ink";

/** Forma e foco de um botão de ação; a cor vem de quem o usa. */
export const authBtnBase =
  "inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg text-sm font-semibold " +
  "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-auth-brand/40 " +
  "focus-visible:ring-offset-2 active:scale-[0.99] disabled:pointer-events-none";

export const authPrimaryBtn =
  `${authBtnBase} bg-auth-brand text-white shadow-sm hover:bg-auth-brand/90 disabled:opacity-60`;

export const authGhostBtn =
  `${authBtnBase} border border-auth-line bg-auth-paper font-medium text-auth-ink ` +
  "hover:bg-auth-ink/[0.04] disabled:opacity-60";

export const authLink =
  "rounded font-semibold text-auth-brand underline-offset-4 transition-colors hover:underline " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-auth-brand/40";
