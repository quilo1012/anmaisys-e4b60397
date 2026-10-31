import type jsPDF from "jspdf";
import regular from "@/assets/finance-report-font.asset.json";
import bold from "@/assets/finance-report-font-bold.asset.json";

let fonts: Promise<string[]> | undefined;
export async function loadFinanceReportFont(doc: jsPDF) {
  fonts ??= Promise.all([regular.url, bold.url].map(async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error("The report font could not be loaded.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(binary);
  })).catch((error) => { fonts = undefined; throw error; });
  const data = await fonts;
  for (const [i, style] of ["normal", "bold"].entries()) {
    const file = `finance-${style}.ttf`;
    doc.addFileToVFS(file, data[i]);
    doc.addFont(file, "FinanceReport", style);
  }
  doc.setFont("FinanceReport", "normal");
}