// Spare parts stock, on paper and in a spreadsheet.
//
// Four exports, because two questions get asked of a warehouse list and each is
// asked in two places: "what do we hold" (the whole list) and "what has to be
// ordered" (only what reached its reorder point), each as a PDF to pin up and as an
// Excel to work in. Same rows, same order, same rule for low — `isLowStock`, not a
// second comparison written here.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import XLSX from "xlsx-js-style";
import logoUrl from "@/assets/appliedlogo.jpeg";
import { isLowStock, type StockRow } from "@/lib/stockList";

const NAVY: [number, number, number] = [30, 58, 138];
const n = (v: number) => Math.round(v).toLocaleString("en-US");
const dash = (v: string | null | undefined) => (v ?? "").trim() || "—";

export const HEADERS = ["Model", "Category", "Description", "Machine", "Line", "Location", "Price", "Qty", "Min"];

/** The rows an export prints, in the order the screen shows them. */
export function exportRows(rows: StockRow[], lowOnly: boolean): StockRow[] {
  return (lowOnly ? rows.filter(isLowStock) : rows);
}

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

export async function exportStockPDF(rows: StockRow[], opts: { lowOnly?: boolean; generatedBy?: string } = {}) {
  const lowOnly = !!opts.lowOnly;
  const list = exportRows(rows, lowOnly);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;
  const logo = await loadLogoDataUrl();
  const generatedOn = new Date().toLocaleString("en-GB");
  const title = lowOnly ? "Spare Parts — Reorder List" : "Spare Parts Stock";

  const drawHeader = () => {
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, pageW, 22, "F");
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(margin, 5, 24, 12, 2, 2, "F");
    if (logo) { try { doc.addImage(logo, "JPEG", margin + 1.5, 6.2, 21, 9.6); } catch { /* ignore */ } }
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold"); doc.setFontSize(14);
    doc.text(title, pageW - margin, 11, { align: "right" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(203, 213, 225);
    doc.text(`${list.length} ${list.length === 1 ? "part" : "parts"}`, pageW - margin, 17, { align: "right" });
    doc.setTextColor(0);
  };

  autoTable(doc, {
    startY: 28,
    head: [HEADERS],
    body: list.length
      ? list.map((r) => [
          r.code,
          r.category,
          dash(r.description),
          dash(r.machine),
          dash(r.line),
          dash(r.location),
          { content: r.price ? `£${Number(r.price).toFixed(2)}` : "—", styles: { halign: "right" } },
          { content: n(r.quantity), styles: { halign: "right", fontStyle: "bold", textColor: isLowStock(r) ? [185, 28, 28] : [15, 23, 42] } },
          { content: n(r.min_stock), styles: { halign: "right" } },
        ])
      : [[{ content: lowOnly ? "Nothing has reached its reorder point." : "No parts in stock yet.", colSpan: HEADERS.length, styles: { halign: "center", fontStyle: "italic", textColor: [100, 116, 139] } }]],
    styles: { fontSize: 8, cellPadding: 1.6, overflow: "linebreak", lineColor: [226, 232, 240], lineWidth: 0.1 },
    headStyles: { fillColor: NAVY, textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 0: { fontStyle: "bold" }, 2: { cellWidth: 60 } },
    margin: { left: margin, right: margin, top: 28 },
  });

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    drawHeader();
    doc.setDrawColor(226, 232, 240);
    doc.line(margin, pageH - 9, pageW - margin, pageH - 9);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(130);
    doc.text(`Applied Nutrition · Confidential · Generated ${generatedOn}${opts.generatedBy ? ` by ${opts.generatedBy}` : ""}`, margin, pageH - 5);
    doc.text(`Page ${p} of ${pages}`, pageW - margin, pageH - 5, { align: "right" });
  }

  doc.save(`${lowOnly ? "spare-parts-reorder" : "spare-parts-stock"}-${Date.now()}.pdf`);
}

export function exportStockExcel(rows: StockRow[], opts: { lowOnly?: boolean } = {}) {
  const lowOnly = !!opts.lowOnly;
  const list = exportRows(rows, lowOnly);
  const header = HEADERS.map((h) => ({
    v: h,
    t: "s",
    s: { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "1E3A8A" } }, alignment: { horizontal: "center" } },
  }));
  const body = list.map((r) => [
    { v: r.code, t: "s" },
    { v: r.category, t: "s" },
    { v: r.description ?? "", t: "s" },
    { v: r.machine ?? "", t: "s" },
    { v: r.line ?? "", t: "s" },
    { v: r.location ?? "", t: "s" },
    { v: Number(r.price ?? 0), t: "n", z: "£#,##0.00" },
    // The number stays a number — a reorder list gets sorted and summed in Excel.
    { v: Number(r.quantity ?? 0), t: "n", s: isLowStock(r) ? { font: { bold: true, color: { rgb: "B91C1C" } } } : undefined },
    { v: Number(r.min_stock ?? 0), t: "n" },
  ]);
  const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
  ws["!cols"] = [{ wch: 18 }, { wch: 16 }, { wch: 40 }, { wch: 18 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 8 }, { wch: 8 }];
  ws["!freeze"] = { xSplit: "0", ySplit: "1" };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, lowOnly ? "Reorder" : "Stock");
  XLSX.writeFile(wb, `${lowOnly ? "spare-parts-reorder" : "spare-parts-stock"}-${Date.now()}.xlsx`);
}
