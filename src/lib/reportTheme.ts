import type jsPDF from "jspdf";
import logoUrl from "@/assets/appliedlogo.jpeg";

/**
 * Shared look for every generated PDF.
 *
 * The Production Performance report had a branded band, KPI cards and navy tables
 * while the Maintenance Orders report used near-black table heads and unbranded
 * grey text — two reports from one system that looked like they came from two.
 * These tokens are the single definition, so a change to the palette moves every
 * report at once instead of drifting.
 */
export type RGB = [number, number, number];

export const NAVY: RGB = [30, 58, 138]; // Applied Nutrition blue
export const INK: RGB = [15, 23, 42];
export const SUBTLE: RGB = [100, 116, 139];
export const CARD_BG: RGB = [248, 250, 252];
export const CARD_BORDER: RGB = [226, 232, 240];

export const GREEN_BG: RGB = [209, 250, 229], GREEN_TX: RGB = [4, 120, 87];
export const AMBER_BG: RGB = [254, 243, 199], AMBER_TX: RGB = [180, 83, 9];
export const RED_BG: RGB = [254, 226, 226], RED_TX: RGB = [185, 28, 28];

export const REPORT_MARGIN = 14;
/** Height of the branded band, and therefore the top margin every table needs. */
export const HEADER_H = 26;

/** Table styling shared by every report table. */
export const tableStyles = {
  styles: { fontSize: 8, cellPadding: 2, lineColor: CARD_BORDER, lineWidth: 0.1 },
  headStyles: { fillColor: NAVY, textColor: 255, fontStyle: "bold" as const },
  alternateRowStyles: { fillColor: CARD_BG },
};

export async function loadLogoDataUrl(): Promise<string | null> {
  try {
    const res = await fetch(logoUrl);
    const blob = await res.blob();
    return await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Navy band with the logo on a white chip, the report title on the right and the
 * period beneath it. Call it once per page — autoTable's didDrawPage is the hook.
 */
export function drawReportHeader(
  doc: jsPDF,
  opts: { title: string; subtitle: string; logo: string | null },
) {
  const pageW = doc.internal.pageSize.getWidth();
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, pageW, HEADER_H, "F");
  // White chip so the JPEG sits on white rather than navy.
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(REPORT_MARGIN, 6, 26, 14, 2, 2, "F");
  if (opts.logo) {
    try { doc.addImage(opts.logo, "JPEG", REPORT_MARGIN + 1.5, 7.5, 23, 11); } catch { /* ignore */ }
  }
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold"); doc.setFontSize(15);
  doc.text(opts.title, pageW - REPORT_MARGIN, 13, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(203, 213, 225);
  doc.text(opts.subtitle, pageW - REPORT_MARGIN, 19, { align: "right" });
  doc.setTextColor(0);
}

/** Hairline rule, confidentiality line and page number at the foot of a page. */
export function drawReportFooter(
  doc: jsPDF,
  opts: { pageNumber: number; generatedOn: string; generatedBy?: string | null },
) {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const by = opts.generatedBy ? ` by ${opts.generatedBy}` : "";
  doc.setDrawColor(...CARD_BORDER);
  doc.line(REPORT_MARGIN, pageH - 10, pageW - REPORT_MARGIN, pageH - 10);
  doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(130);
  doc.text(`Applied Nutrition · Confidential · Generated ${opts.generatedOn}${by}`, REPORT_MARGIN, pageH - 6);
  doc.text(`Page ${opts.pageNumber}`, pageW - REPORT_MARGIN, pageH - 6, { align: "right" });
}

/**
 * KPI card: tinted panel, hairline border and a colour bar down the left edge.
 * `accent` carries the meaning — green when a number is healthy, red when it is not.
 */
export function drawKpiCard(
  doc: jsPDF,
  opts: { x: number; y: number; w: number; h: number; label: string; value: string; valueColor?: RGB; accent?: RGB },
) {
  const { x, y, w, h, label, value } = opts;
  const valueColor = opts.valueColor ?? INK;
  const accent = opts.accent ?? NAVY;
  doc.setFillColor(...CARD_BG); doc.setDrawColor(...CARD_BORDER);
  doc.roundedRect(x, y, w, h, 2, 2, "FD");
  doc.setFillColor(...accent);
  doc.roundedRect(x, y, 1.6, h, 0.8, 0.8, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(...SUBTLE);
  doc.text(label.toUpperCase(), x + 5, y + 6);
  doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.setTextColor(...valueColor);
  doc.text(value, x + 5, y + 15.5);
}
