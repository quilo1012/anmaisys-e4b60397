/* eslint-disable @typescript-eslint/no-explicit-any -- jsPDF autoTable cells are loosely typed */
/**
 * A moldura dos relatórios em PDF: banda azul com o logótipo, rodapé com a
 * paginação, cartões de KPI, títulos de secção e os defaults do autoTable.
 *
 * Vivia toda dentro do `generateDowntimeReportPDF`. Quando o armazém quis a sua
 * própria folha, a escolha era copiar a moldura ou levantá-la: duas molduras
 * divergem à primeira vez que alguém mexe numa cor, e ficam duas folhas da mesma
 * fábrica com dois cabeçalhos diferentes.
 *
 * O que cada relatório escreve por dentro continua a ser dele.
 */
import jsPDF from "jspdf";
import logoUrl from "@/assets/appliedlogo.jpeg";

export type RGB = [number, number, number];

export const NAVY: RGB = [30, 58, 138];
export const INK: RGB = [15, 23, 42];
export const SUBTLE: RGB = [100, 116, 139];
export const CARD_BG: RGB = [248, 250, 252];
export const CARD_BORDER: RGB = [226, 232, 240];
export const GREEN_BG: RGB = [209, 250, 229], GREEN_TX: RGB = [4, 120, 87];
export const AMBER_BG: RGB = [254, 243, 199], AMBER_TX: RGB = [180, 83, 9];
export const RED_BG: RGB = [254, 226, 226], RED_TX: RGB = [185, 28, 28];

export const statusChip = (s: string): { fillColor: RGB; textColor: RGB } => {
  const t = (s || "").toLowerCase();
  if (t.includes("active") || t.includes("ongoing")) return { fillColor: AMBER_BG, textColor: AMBER_TX };
  return { fillColor: GREEN_BG, textColor: GREEN_TX };
};

async function loadLogoDataUrl(): Promise<string | null> {
  try {
    const res = await fetch(logoUrl);
    const blob = await res.blob();
    return await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.readAsDataURL(blob);
    });
  } catch { return null; }
}

export interface KpiCard {
  label: string;
  value: string;
  valueColor?: RGB;
  accent?: RGB;
}

export interface ReportChrome {
  doc: jsPDF;
  pageW: number;
  pageH: number;
  margin: number;
  /** O cursor vertical. Cada secção avança-o depois de desenhar. */
  y: number;
  drawHeader(): void;
  drawFooter(data?: any): void;
  /** Os defaults de tabela — espalhar com `...chrome.commonTable`. */
  commonTable: Record<string, any>;
  sectionTitle(title: string, count?: number): void;
  kpiCards(cards: KpiCard[]): void;
  /** Uma linha de texto miúdo por baixo dos cartões — os filtros em vigor. */
  captionLine(text: string): void;
  /** Salta de página quando o que falta não chega para a próxima secção. */
  ensureSpace(needed?: number): void;
  /** A posição a que a última tabela chegou, mais uma folga. */
  afterTable(gap?: number): void;
  /** Guarda ou devolve a folha. `fileBase` vai para o nome tal como chega, sem extensão. */
  finish(fileBase: string, opts?: { output?: "save" | "bloburl" }): string | undefined;
}

export async function createReportChrome(input: {
  /** O que a banda azul diz em cima, e o rodapé repete. */
  title: string;
  /** O período, por baixo do título. */
  rangeLabel: string;
  orientation?: "landscape" | "portrait";
}): Promise<ReportChrome> {
  const { title, rangeLabel, orientation = "landscape" } = input;
  const doc = new jsPDF({ orientation, unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;
  const logo = await loadLogoDataUrl();
  const generatedOn = new Date().toLocaleString("en-GB");

  const drawHeader = () => {
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, pageW, 24, "F");
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(margin, 5, 24, 13, 2, 2, "F");
    if (logo) { try { doc.addImage(logo, "JPEG", margin + 1.5, 6.3, 21, 10.4); } catch { /* ignore */ } }
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold"); doc.setFontSize(15);
    doc.text(title, pageW - margin, 11, { align: "right" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(203, 213, 225);
    doc.text(rangeLabel, pageW - margin, 17.5, { align: "right" });
    doc.setTextColor(0);
  };
  const drawFooter = (data?: any) => {
    doc.setDrawColor(...CARD_BORDER);
    doc.line(margin, pageH - 9, pageW - margin, pageH - 9);
    doc.setFontSize(7); doc.setTextColor(...SUBTLE); doc.setFont("helvetica", "normal");
    doc.text(`${title} · Generated ${generatedOn}`, margin, pageH - 5);
    const page = data?.pageNumber ?? doc.getNumberOfPages();
    doc.text(`Page ${page}`, pageW - margin, pageH - 5, { align: "right" });
  };

  const chrome: ReportChrome = {
    doc, pageW, pageH, margin,
    y: 30,
    drawHeader,
    drawFooter,
    commonTable: {
      styles: { fontSize: 8, cellPadding: 1.8, overflow: "linebreak" as const, lineColor: CARD_BORDER, lineWidth: 0.1 },
      headStyles: { fillColor: NAVY, textColor: 255 as any, fontStyle: "bold" as const },
      alternateRowStyles: { fillColor: [248, 250, 252] as any },
      margin: { left: margin, right: margin, top: 28 },
      didDrawPage: (data: any) => { if (data.pageNumber > 1) drawHeader(); drawFooter(data); },
    },
    sectionTitle(t: string, count?: number) {
      doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(...INK);
      doc.text(count === undefined ? t : `${t}  (${count})`, margin, chrome.y);
      chrome.y += 2.5;
    },
    kpiCards(cards: KpiCard[]) {
      const cardY = 30, cardH = 20, gap = 4;
      const cols = cards.length;
      const cardW = (pageW - margin * 2 - gap * (cols - 1)) / cols;
      cards.forEach((c, i) => {
        const x = margin + i * (cardW + gap);
        doc.setFillColor(...CARD_BG); doc.setDrawColor(...CARD_BORDER);
        doc.roundedRect(x, cardY, cardW, cardH, 2, 2, "FD");
        doc.setFillColor(...(c.accent ?? NAVY));
        doc.roundedRect(x, cardY, 1.6, cardH, 0.8, 0.8, "F");
        doc.setFont("helvetica", "bold"); doc.setFontSize(6.5); doc.setTextColor(...SUBTLE);
        doc.text(c.label.toUpperCase(), x + 4.5, cardY + 6);
        doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(...(c.valueColor ?? INK));
        doc.text(c.value, x + 4.5, cardY + 15);
      });
      chrome.y = cardY + cardH + 6;
    },
    captionLine(text: string) {
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...SUBTLE);
      doc.text(text, margin, chrome.y);
      chrome.y += 5;
    },
    ensureSpace(needed = 40) {
      if (chrome.y > pageH - needed) { doc.addPage(); drawHeader(); chrome.y = 30; }
    },
    afterTable(gap = 8) {
      chrome.y = (doc as any).lastAutoTable.finalY + gap;
    },
    finish(fileBase: string, opts?: { output?: "save" | "bloburl" }) {
      if (opts?.output === "bloburl") return doc.output("bloburl") as unknown as string;
      // `fileBase` chega já limpo: o nome do ficheiro é do relatório, não da moldura.
      doc.save(`${fileBase}.pdf`);
      return undefined;
    },
  };

  drawHeader();
  return chrome;
}
