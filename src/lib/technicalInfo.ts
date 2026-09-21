// Technical info topics shown in the Engineer Console.
//
// A topic is either a table (columns + rows, freely editable) or a PDF document such as a
// machine manual. Topics live in the database so every device — and every QR code scan —
// sees the same information.
import jsPDF from "jspdf";
import QRCode from "qrcode";

export type TopicKind = "table" | "pdf";

export type TechnicalTopic = {
  id: string;
  title: string;
  kind: TopicKind;
  columns: string[];
  rows: string[][];
  note: string | null;
  file_path: string | null;
  sort_order: number;
  updated_at?: string;
};

export const DEFAULT_TABLE_COLUMNS = ["Prog", "Pallet", "Tub", "Boxes per layer", "Total layers", "Total tubes"];

/** A row is stored as a plain array, so adding a column simply widens every row. */
export const padRow = (row: string[], width: number): string[] =>
  Array.from({ length: width }, (_, i) => row[i] ?? "");

export const normaliseTopic = (t: TechnicalTopic): TechnicalTopic => ({
  ...t,
  columns: Array.isArray(t.columns) ? t.columns : [],
  rows: (Array.isArray(t.rows) ? t.rows : []).map((r) => padRow(Array.isArray(r) ? r : [], (t.columns ?? []).length)),
});

/** The page a scanned QR code opens — the topic as it is right now, not a frozen copy. */
export const topicUrl = (id: string) =>
  `${typeof window !== "undefined" ? window.location.origin : ""}/dashboard/technical-info/${id}`;

export const topicQrDataUrl = (id: string) =>
  QRCode.toDataURL(topicUrl(id), { errorCorrectionLevel: "M", margin: 1, width: 400 });

/** A4 sheet for the machine: the table, the note and a QR that opens the same topic. */
export async function exportTopicSheetPDF(topic: TechnicalTopic) {
  const doc = new jsPDF({ orientation: topic.columns.length > 6 ? "landscape" : "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const m = 15;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(topic.title, m, m + 4, { maxWidth: pageW - 2 * m });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(`Applied Nutrition · Technical information · ${new Date().toLocaleDateString("en-GB")}`, m, m + 11);
  doc.setTextColor(0);

  const tableW = pageW - 2 * m;
  const colW = tableW / Math.max(topic.columns.length, 1);
  let y = m + 20;
  const rowH = 10;

  const drawRow = (cells: string[], bold: boolean) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(bold ? 10 : 11);
    let x = m;
    cells.forEach((c) => {
      doc.setDrawColor(120);
      doc.setLineWidth(0.2);
      doc.rect(x, y, colW, rowH);
      doc.text(String(c ?? ""), x + colW / 2, y + rowH / 2 + 1.5, { align: "center", maxWidth: colW - 2 });
      x += colW;
    });
    y += rowH;
  };

  drawRow(topic.columns, true);
  topic.rows.forEach((r) => drawRow(padRow(r, topic.columns.length), false));

  if (topic.note) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(topic.note.toUpperCase(), m, y + 10);
  }

  const qr = await topicQrDataUrl(topic.id);
  const qrSize = 45;
  doc.addImage(qr, "PNG", m, y + 18, qrSize, qrSize);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100);
  doc.text("Scan to open this information", m, y + 18 + qrSize + 4);

  doc.save(`technical-info-${topic.id}.pdf`);
}

/** Small QR-only label to fix on the machine. */
export async function exportTopicQrLabelPDF(topic: TechnicalTopic) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: [80, 100] });
  const qr = await topicQrDataUrl(topic.id);
  doc.addImage(qr, "PNG", 10, 16, 60, 60);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(topic.title.toUpperCase(), 40, 10, { align: "center", maxWidth: 70 });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("Scan to open this information", 40, 84, { align: "center" });
  if (topic.note) doc.text(topic.note, 40, 90, { align: "center", maxWidth: 70 });
  doc.save(`technical-info-qr-${topic.id}.pdf`);
}
