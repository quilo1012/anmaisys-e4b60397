// Um único dono do ícone do separador.
//
// O favicon era escrito de dois sítios — o ecrã de login (branding por tablet /
// por modo) e o crachá de alerta crítico — e cada um deles fazia a mesma coisa
// errada de duas maneiras: pegava só no primeiro `link[rel~="icon"]` do head, e
// guardava "o href que lá estava" como sendo o valor a repor. Com mais do que um
// link de ícone no head, metade dos links ficava por escrever; e quando os dois
// escritores se cruzavam, um guardava o valor temporário do outro como se fosse
// o original, e o separador ficava a mostrar o que calhasse ter sido escrito por
// último.
//
// Aqui há duas camadas empilhadas sobre o que o markup declarou — a marca
// (login) e o crachá (alertas) — e cada escritor mexe só na sua. O que vai para
// o head é sempre `crachá ?? marca ?? markup`, calculado num sítio só, e o
// markup é lido uma vez antes de alguém lhe tocar.

/**
 * A imagem sobre a qual o crachá de alerta é desenhado quando não há marca
 * própria em vigor. É um PNG e não o .ico de propósito — o canvas tem de
 * conseguir decodificar o que lhe damos, e o suporte a ICO em `<img>` varia
 * entre browsers.
 */
export const BADGE_BASE_FAVICON = "/favicon.png";

type Snapshot = { link: HTMLLinkElement; href: string };

let markup: Snapshot[] | null = null;
/** Camada da marca: branding por tablet / por modo, posta pelo login. */
let brand: string | null = null;
/** Camada do crachá: sobreposição temporária dos alertas por reconhecer. */
let badge: string | null = null;

function iconLinks(): HTMLLinkElement[] {
  return Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'));
}

/** Lê (uma só vez) o que o markup declarou, antes de qualquer escrita. */
function readMarkup(): Snapshot[] {
  if (!markup) {
    markup = iconLinks().map((link) => ({
      link,
      href: link.getAttribute("href") ?? BADGE_BASE_FAVICON,
    }));
  }
  return markup;
}

/** Escreve a camada de cima em todos os links de ícone. */
function apply(): void {
  const snap = readMarkup();
  const top = badge ?? brand;
  if (top) {
    for (const link of iconLinks()) link.setAttribute("href", top);
    return;
  }
  for (const { link, href } of snap) link.setAttribute("href", href);
}

/** Marca própria do ecrã de login (por tablet ou por modo de entrada). */
export function setFavicon(url: string): void {
  brand = url;
  apply();
}

/** Larga a marca própria; o separador volta ao que o markup declarou. */
export function resetFavicon(): void {
  brand = null;
  apply();
}

/** Sobrepõe o crachá desenhado. Não mexe na marca por baixo. */
export function setFaviconBadge(dataUrl: string): void {
  badge = dataUrl;
  apply();
}

/** Tira o crachá, descobrindo a marca que estivesse por baixo. */
export function clearFaviconBadge(): void {
  badge = null;
  apply();
}

/**
 * A imagem sobre a qual desenhar o crachá: a marca em vigor, se houver (um
 * tablet com marca própria continua a ser reconhecível com o crachá em cima),
 * senão a marca do sistema. Nunca o crachá anterior — desenhar sobre ele
 * empilhava um crachá em cima do outro a cada alerta novo.
 */
export function badgeBaseUrl(): string {
  return brand ?? BADGE_BASE_FAVICON;
}
