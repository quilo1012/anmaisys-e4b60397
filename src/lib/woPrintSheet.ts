/**
 * The maintenance order's own print stylesheet.
 *
 * Kept out of `index.css` on purpose. `printElementAsDocument` clones the order into
 * an isolated iframe and injects this last, so these rules apply to that document and
 * to nothing else — no other report changes shape because the order changed shape.
 *
 * Two things make them win where they need to. They arrive after the shared print
 * rules in source order, and where they name `#wo-print-content` they carry an id,
 * which any Tailwind `print:` utility loses to: a media query adds no specificity.
 *
 * ── What the sheet is ──────────────────────────────────────────────────────────
 * On screen the order is a stack of cards, each one floating in 24px of air. Printed,
 * that air was most of a second sheet, and the second sheet carried two signature
 * lines and nothing else. On paper the bands butt together into a single ruled form:
 * denser, and the shape a record that gets signed in ink and filed actually has.
 *
 * Field labels are set in Archivo, small and letterspaced; figures and timestamps in
 * IBM Plex Mono, so times and durations line up in a column. Both faces are already
 * loaded by the app and come across with the cloned stylesheets.
 */
export const WO_SHEET_CSS = `
/* ── Paper ─────────────────────────────────────────────────────────────────── */
body {
  padding: 8mm 9mm 6mm;
  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
  font-size: 8.4pt;
  line-height: 1.3;
  color: #000;
}

/* ── The frame ─────────────────────────────────────────────────────────────── */
#wo-print-content {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-content: start;
  gap: 0;
  max-width: none;
  margin: 0;
}
/* \`space-y-6\` is a margin on every child but the first — 24px per seam, eleven
   seams, 63mm of paper spent on nothing. */
#wo-print-content > * { margin: 0 !important; min-width: 0; grid-column: span 2; }

#wo-print-content > [data-wo] {
  border: 1px solid #000;
  border-radius: 0;
  box-shadow: none;
  background: #fff;
  overflow: hidden;
  break-inside: avoid;
}

/* Reading order on paper is not the order the screen builds the page in, and the
   pairs are chosen for what gets read together: what broke beside what was done,
   how long it took beside what it cost the line. */
#wo-print-content > [data-wo="header"]     { order: 1; }
#wo-print-content > [data-wo="problem"]    { order: 2; grid-column: span 1; }
#wo-print-content > [data-wo="resolution"] { order: 3; grid-column: span 1; }
#wo-print-content > [data-wo="attendance"] { order: 4; grid-column: span 1; }
#wo-print-content > [data-wo="impact"]     { order: 5; grid-column: span 1; }
#wo-print-content > [data-wo="timeline"]   { order: 6; }
#wo-print-content > [data-wo="stops"]      { order: 7; }
#wo-print-content > [data-wo="checklist"]  { order: 8; }
#wo-print-content > [data-wo="parts"]      { order: 9; }
#wo-print-content > [data-wo="photos"]     { order: 10; }
#wo-print-content > [data-wo="signature"]  { order: 11; }

/* The requester and the engineer are named in the header row and again over the two
   signature lines. A third copy had a band of its own. */
#wo-print-content > [data-wo="personnel"] { display: none !important; }

/* ── Bands ─────────────────────────────────────────────────────────────────── */
/* A card is CardHeader + CardContent, both \`p-6\`: 6mm a side, per band, per edge. */
#wo-print-content > [data-wo]:not([data-wo="header"]):not([data-wo="signature"]) > div {
  padding: 1.3mm 2.4mm !important;
}
#wo-print-content > [data-wo]:not([data-wo="header"]):not([data-wo="signature"]) > div + div {
  padding-top: 0 !important;
}

/* Band titles are field labels on a form, not headings on a page. */
#wo-print-content > [data-wo] > div:first-child h3 {
  font-family: Archivo, Inter, sans-serif;
  font-size: 6.6pt;
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #000;
}
#wo-print-content > [data-wo] p { margin: 0; }

/* Figures — durations, counts, timestamps — in the tabular face they were set in. */
#wo-print-content .font-figure,
#wo-print-content .font-mono {
  font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, monospace;
  font-variant-numeric: tabular-nums;
}

/* Nothing prints in grey. A laser at 600dpi turns \`text-muted-foreground\` into a
   stipple that survives one photocopy; the labels on a form that gets photocopied
   have to hold. Rank is carried by size and weight instead. */
#wo-print-content [class*="text-muted-foreground"],
#wo-print-content [class*="text-gray-"] { color: #333 !important; }

/* ── Masthead ──────────────────────────────────────────────────────────────── */
#wo-print-content > [data-wo="header"] { border: 0; }
#wo-print-content > [data-wo="header"] img { height: 9mm !important; width: auto !important; }

/* ── Attendance times · Production impact ──────────────────────────────────── */
/* Two bands of three figures, side by side: one row of paper instead of two. The
   figures run edge to edge under the label and are divided by a rule, so the band
   is a row of fields rather than three boxes floating inside a fourth. */
#wo-print-content > [data-wo="attendance"] > div + div,
#wo-print-content > [data-wo="impact"] > div + div { padding: 0 !important; }
#wo-print-content > [data-wo="attendance"] .grid,
#wo-print-content > [data-wo="impact"] .grid { border-top: 1px solid #000; }
#wo-print-content > [data-wo="attendance"] .grid > div,
#wo-print-content > [data-wo="impact"] .grid > div {
  border: 0 !important;
  border-left: 1px solid #000 !important;
  padding: 1.2mm 1mm !important;
}
#wo-print-content > [data-wo="attendance"] .grid > div:first-child,
#wo-print-content > [data-wo="impact"] .grid > div:first-child { border-left: 0 !important; }

/* Line status is the one figure that is a word. It is set in the display face and
   in black: the sheet is printed on the mono laser by the line, where the green that
   carried "running" on screen arrives as the same grey as "stopped". */
#wo-print-content > [data-wo="impact"] .grid > div:first-child p:nth-child(2) {
  font-family: Archivo, Inter, sans-serif;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #000 !important;
}

/* ── Timeline ──────────────────────────────────────────────────────────────── */
/* A chronology is a list, and a list set once down 190mm of paper is mostly margin.
   Two balanced columns are read in the same order and take half the band. */
#wo-print-content > [data-wo="timeline"] ol {
  columns: 2;
  column-gap: 5mm;
  column-rule: 1px solid #bbb;
  border: 0 !important;
  padding: 0 !important;
  margin: 0 !important;
}
#wo-print-content > [data-wo="timeline"] ol > li {
  margin: 0 0 1mm !important;
  break-inside: avoid;
  -webkit-column-break-inside: avoid;
}
/* The marker hung in a gutter the columns no longer have. */
#wo-print-content > [data-wo="timeline"] ol > li > div > span:first-child {
  margin-left: 0 !important;
  width: 3.2mm !important;
  font-size: 5.5pt;
}
#wo-print-content > [data-wo="timeline"] ol > li > div { gap: 1.4mm !important; }
#wo-print-content > [data-wo="timeline"] ol > li > p { margin-left: 4.6mm !important; }

/* ── Tables: line stops, parts used ────────────────────────────────────────── */
#wo-print-content table { width: 100%; border-collapse: collapse; font-size: 7pt; }
/* \`text-sm\` on a single cell (the date a part was fitted) set that column two
   points larger than the rest of its own table. A table is one size. */
#wo-print-content th,
#wo-print-content td {
  padding: 0.7mm 1.4mm !important;
  border: 1px solid #000;
  font-size: 7pt !important;
  line-height: 1.25;
}
#wo-print-content th {
  background: #eee;
  font-family: Archivo, Inter, sans-serif;
  font-size: 6.4pt;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  text-align: left;
  height: auto !important;
}
/* The stop count and the total are already the middle band's two big figures. */
#wo-print-content > [data-wo="stops"] .flex-wrap { display: none !important; }

/* ── Photos ────────────────────────────────────────────────────────────────── */
#wo-print-content > [data-wo="photos"] img { max-height: 45mm; object-fit: contain; }

/* ── Signatures ────────────────────────────────────────────────────────────── */
/* The band the whole sheet exists to carry: it stays with the record, never alone
   on a second page. */
#wo-print-content > [data-wo="signature"] {
  border: 1px solid #000;
  border-top-width: 2px;
  padding: 2mm 2.4mm 1.5mm !important;
  break-inside: avoid;
}
#wo-print-content > [data-wo="signature"] .print-doc-footer {
  margin-top: 2mm !important;
  padding-top: 1mm !important;
}
`;
