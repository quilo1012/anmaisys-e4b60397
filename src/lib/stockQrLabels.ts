// QR labels for the shelf.
//
// The QR carries the part's `code` — the unique key `products` already has — and
// nothing else, so a label printed today still reads next year no matter what the
// URL of this app is. The scanner matches the text back to the same column.
import jsPDF from "jspdf";
import QRCode from "qrcode";
import type { StockRow } from "@/lib/stockList";

/** What is encoded in the QR: the code, trimmed. Kept in one place so printing and
 *  reading cannot disagree about it. */
export const qrPayload = (code: string) => code.trim();

/** The code a scanner read, normalised the same way before lookup. */
export const codeFromQr = (text: string) => text.trim().toUpperCase();

type LabelRow = Pick<StockRow, "code" | "category" | "location" | "description">;

const qrDataUrl = (code: string) =>
  QRCode.toDataURL(qrPayload(code), { errorCorrectionLevel: "M", margin: 1, width: 300 });

/**
 * A4 portrait sheet of labels, 3 × 7 per page (Avery-style 63 × 38 mm), one per part,
 * in the order the list is shown. Cut along the borders.
 */
export async function exportStockQrLabelsPDF(rows: LabelRow[], opts: { title?: string } = {}) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const cols = 3, perPage = 21;
  const cellW = 63, cellH = 38;
  const marginX = (pageW - cols * cellW) / 2;
  const marginY = (pageH - 7 * cellH) / 2;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const slot = i % perPage;
    if (i > 0 && slot === 0) doc.addPage();
    const col = slot % cols;
    const row = Math.floor(slot / cols);
    const x = marginX + col * cellW;
    const y = marginY + row * cellH;

    doc.setDrawColor(200);
    doc.setLineWidth(0.1);
    doc.rect(x, y, cellW, cellH);

    const qrSize = 30;
    const img = await qrDataUrl(r.code);
    doc.addImage(img, "PNG", x + 3, y + (cellH - qrSize) / 2, qrSize, qrSize);

    const tx = x + 3 + qrSize + 3;
    const tw = cellW - (qrSize + 9);
    doc.setTextColor(15, 23, 42);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(r.code.length > 14 ? 8 : 10);
    const codeLines = doc.splitTextToSize(r.code, tw).slice(0, 2);
    doc.text(codeLines, tx, y + 10);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(71, 85, 105);
    const meta = [r.category, r.location ? `Loc: ${r.location}` : ""].filter(Boolean).join(" · ");
    let ty = y + 10 + codeLines.length * 4.5;
    if (meta) { doc.text(doc.splitTextToSize(meta, tw).slice(0, 2), tx, ty); ty += 7; }
    if (r.description) {
      doc.setTextColor(100, 116, 139);
      doc.text(doc.splitTextToSize(r.description, tw).slice(0, 3), tx, ty);
    }
  }

  if (!rows.length) {
    doc.setFontSize(12);
    doc.text("No parts to print.", pageW / 2, pageH / 2, { align: "center" });
  }

  doc.save(`${opts.title ?? "spare-parts-qr-labels"}-${Date.now()}.pdf`);
}

/** One label on its own small page — for reprinting a single shelf tag. */
export async function exportSingleQrLabelPDF(r: LabelRow) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: [63, 38] });
  doc.setDrawColor(200);
  doc.rect(0.5, 0.5, 62, 37);
  const img = await qrDataUrl(r.code);
  doc.addImage(img, "PNG", 3, 4, 30, 30);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(r.code.length > 14 ? 8 : 10);
  const codeLines = doc.splitTextToSize(r.code, 26).slice(0, 2);
  doc.text(codeLines, 36, 10);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(71, 85, 105);
  const meta = [r.category, r.location ? `Loc: ${r.location}` : ""].filter(Boolean).join(" · ");
  if (meta) doc.text(doc.splitTextToSize(meta, 26).slice(0, 2), 36, 10 + codeLines.length * 4.5);
  doc.save(`qr-${r.code.replace(/[^\w-]+/g, "_")}.pdf`);
}
