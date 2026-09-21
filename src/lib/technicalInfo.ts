// Technical info sheets shown in the Engineer Console.
//
// The first topic is the palletiser robot's pallet configuration, transcribed from the
// handwritten sheet kept on the machine. Engineers can add or remove rows and print the
// result as an A4 sheet (or a QR label) to fix on the machine itself.
//
// The rows live in this browser (localStorage), not in the database: no schema change was
// requested for this, so edits are per-device until we decide to store them centrally.
import jsPDF from "jspdf";
import QRCode from "qrcode";

export type PalletRow = {
  id: string;
  prog: string;
  pallet: string;
  tub: string;
  boxesPerLayer: string;
  totalLayers: string;
  totalTubes: string;
};

export const PALLET_COLUMNS: { key: keyof Omit<PalletRow, "id">; label: string }[] = [
  { key: "prog", label: "Prog" },
  { key: "pallet", label: "Pallet" },
  { key: "tub", label: "Tub" },
  { key: "boxesPerLayer", label: "Boxes per layer" },
  { key: "totalLayers", label: "Total layers" },
  { key: "totalTubes", label: "Total tubes" },
];

const rid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const row = (
  prog: string,
  pallet: string,
  tub: string,
  boxesPerLayer: string,
  totalLayers: string,
  totalTubes: string,
): PalletRow => ({ id: rid(), prog, pallet, tub, boxesPerLayer, totalLayers, totalTubes });

/** Transcribed from the sheet on the machine. */
export const DEFAULT_PALLET_ROWS: PalletRow[] = [
  row("1", "EURO", "750", "6", "11", "792"),
  row("2", "EURO", "1000", "6", "8", "576"),
  row("3", "STANDARD", "750", "8", "15", "1500"),
  row("4", "STANDARD", "750", "8", "10", "960"),
  row("5", "STANDARD", "1000", "8", "13", "1248"),
  row("6", "STANDARD", "750", "16", "11", "792"),
  row("7", "STANDARD", "750", "8", "8", "768"),
];

export const PALLET_NOTE = "6 tubes per box";

const KEY = "technical-info.palletiser.v1";

export function loadPalletRows(): PalletRow[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PALLET_ROWS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_PALLET_ROWS;
    return parsed.map((r: Partial<PalletRow>) => ({
      id: r.id || rid(),
      prog: r.prog ?? "",
      pallet: r.pallet ?? "",
      tub: r.tub ?? "",
      boxesPerLayer: r.boxesPerLayer ?? "",
      totalLayers: r.totalLayers ?? "",
      totalTubes: r.totalTubes ?? "",
    }));
  } catch {
    return DEFAULT_PALLET_ROWS;
  }
}

export function savePalletRows(rows: PalletRow[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows));
  } catch {
    /* private mode — the table still works for this session */
  }
}

export const emptyPalletRow = (): PalletRow => row("", "", "", "", "", "");

/** Plain-text version of the table — what the QR carries, so a scan reads offline. */
export function palletRowsAsText(rows: PalletRow[], note = PALLET_NOTE): string {
  const head = "PALLETISER ROBOT - PALLET CONFIGURATION";
  const body = rows.map(
    (r) =>
      `${r.prog} ${r.pallet} ${r.tub} | ${r.boxesPerLayer} boxes/layer | ${r.totalLayers} layers | ${r.totalTubes} tubes`,
  );
  return [head, ...body, note].join("\n");
}

export const palletQrDataUrl = (rows: PalletRow[]) =>
  QRCode.toDataURL(palletRowsAsText(rows), { errorCorrectionLevel: "M", margin: 1, width: 400 });

/** A4 sheet for the machine: the table, the note and a QR of the same information. */
export async function exportPalletSheetPDF(rows: PalletRow[], title = "Palletiser Robot — Pallet configuration") {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const m = 15;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(title, m, m + 4);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(`Applied Nutrition · Technical information · ${new Date().toLocaleDateString("en-GB")}`, m, m + 11);
  doc.setTextColor(0);

  const widths = [18, 34, 22, 34, 28, 30];
  const tableW = widths.reduce((a, b) => a + b, 0);
  let y = m + 20;
  const rowH = 10;

  const drawRow = (cells: string[], bold: boolean) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(bold ? 10 : 11);
    let x = m;
    cells.forEach((c, i) => {
      doc.setDrawColor(120);
      doc.setLineWidth(0.2);
      doc.rect(x, y, widths[i], rowH);
      doc.text(String(c ?? ""), x + widths[i] / 2, y + rowH / 2 + 1.5, { align: "center", maxWidth: widths[i] - 2 });
      x += widths[i];
    });
    y += rowH;
  };

  drawRow(PALLET_COLUMNS.map((c) => c.label), true);
  rows.forEach((r) => drawRow(PALLET_COLUMNS.map((c) => r[c.key]), false));

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(PALLET_NOTE.toUpperCase(), m, y + 10);

  const qr = await palletQrDataUrl(rows);
  const qrSize = 45;
  doc.addImage(qr, "PNG", m + tableW - qrSize, y + 18, qrSize, qrSize);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100);
  doc.text("Scan to read this table", m + tableW - qrSize, y + 18 + qrSize + 4);

  doc.save(`palletiser-pallet-configuration-${Date.now()}.pdf`);
}

/** Small QR-only label to fix on the machine. */
export async function exportPalletQrLabelPDF(rows: PalletRow[]) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: [80, 100] });
  const qr = await palletQrDataUrl(rows);
  doc.addImage(qr, "PNG", 10, 14, 60, 60);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("PALLETISER ROBOT", 40, 9, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("Pallet configuration — scan to read", 40, 80, { align: "center" });
  doc.text(PALLET_NOTE, 40, 86, { align: "center" });
  doc.save(`palletiser-qr-label-${Date.now()}.pdf`);
}
