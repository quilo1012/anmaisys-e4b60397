import { useEffect, useMemo, useState } from "react";
import { BookOpen, Plus, Trash2, FileDown, QrCode, RotateCcw } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  dialogContentResponsive,
  dialogTitleResponsive,
} from "@/components/ResponsiveDialogShell";
import {
  DEFAULT_PALLET_ROWS,
  PALLET_COLUMNS,
  PALLET_NOTE,
  type PalletRow,
  emptyPalletRow,
  exportPalletQrLabelPDF,
  exportPalletSheetPDF,
  loadPalletRows,
  palletQrDataUrl,
  savePalletRows,
} from "@/lib/technicalInfo";

/**
 * Technical information for the shop floor: procedures kept as collapsible topics.
 * First topic — the palletiser robot's pallet configuration, editable and printable
 * as an A4 sheet or a QR label to fix on the machine.
 */
export function TechnicalInfoDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [rows, setRows] = useState<PalletRow[]>([]);
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    if (open) setRows(loadPalletRows());
  }, [open]);

  const update = (next: PalletRow[]) => {
    setRows(next);
    savePalletRows(next);
    setQr(null);
  };

  const setCell = (id: string, key: keyof Omit<PalletRow, "id">, value: string) =>
    update(rows.map((r) => (r.id === id ? { ...r, [key]: value } : r)));

  const showQr = async () => {
    try {
      setQr(await palletQrDataUrl(rows));
    } catch {
      toast.error("Could not build the QR code.");
    }
  };

  const gridCols = useMemo(() => `minmax(0,0.6fr) repeat(${PALLET_COLUMNS.length - 1}, minmax(0,1fr)) 2.5rem`, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={dialogContentResponsive}>
        <DialogHeader>
          <DialogTitle className={dialogTitleResponsive}>
            <BookOpen className="h-5 w-5 text-primary" /> Technical Info
          </DialogTitle>
          <DialogDescription>
            Machine procedures and reference tables. Print a sheet or a QR label to fix on the machine.
          </DialogDescription>
        </DialogHeader>

        <Accordion type="single" collapsible defaultValue="palletiser" className="w-full">
          <AccordionItem value="palletiser">
            <AccordionTrigger className="text-left">Palletiser Robot — Pallet configuration</AccordionTrigger>
            <AccordionContent className="space-y-3">
              <div className="overflow-x-auto">
                <div className="min-w-[640px] space-y-1">
                  <div className="grid gap-1 text-[11px] font-semibold uppercase text-muted-foreground" style={{ gridTemplateColumns: gridCols }}>
                    {PALLET_COLUMNS.map((c) => (
                      <div key={c.key} className="px-1">{c.label}</div>
                    ))}
                    <div />
                  </div>
                  {rows.map((r) => (
                    <div key={r.id} className="grid items-center gap-1" style={{ gridTemplateColumns: gridCols }}>
                      {PALLET_COLUMNS.map((c) => (
                        <Input
                          key={c.key}
                          value={r[c.key]}
                          onChange={(e) => setCell(r.id, c.key, e.target.value)}
                          aria-label={`${c.label} row ${r.prog || ""}`}
                          className="h-10 text-sm"
                          autoComplete="off"
                        />
                      ))}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10 text-destructive-strong"
                        aria-label="Delete row"
                        onClick={() => update(rows.filter((x) => x.id !== r.id))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              <p className="text-sm font-semibold">{PALLET_NOTE}</p>

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" className="gap-1" onClick={() => update([...rows, emptyPalletRow()])}>
                  <Plus className="h-4 w-4" /> Add row
                </Button>
                <Button variant="outline" size="sm" className="gap-1" onClick={() => exportPalletSheetPDF(rows)}>
                  <FileDown className="h-4 w-4" /> PDF sheet
                </Button>
                <Button variant="outline" size="sm" className="gap-1" onClick={showQr}>
                  <QrCode className="h-4 w-4" /> QR code
                </Button>
                <Button variant="ghost" size="sm" className="gap-1" onClick={() => update(DEFAULT_PALLET_ROWS)}>
                  <RotateCcw className="h-4 w-4" /> Reset
                </Button>
              </div>

              {qr && (
                <div className="flex flex-col items-center gap-2 rounded-md border p-3">
                  <img src={qr} alt="QR code with the pallet configuration" className="h-40 w-40" />
                  <p className="text-xs text-muted-foreground text-center">
                    Scanning shows this table — it works without the app.
                  </p>
                  <Button variant="outline" size="sm" className="gap-1" onClick={() => exportPalletQrLabelPDF(rows)}>
                    <FileDown className="h-4 w-4" /> Print QR label
                  </Button>
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Edits are kept on this device. Printed sheets and QR labels always use what you see here.
              </p>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </DialogContent>
    </Dialog>
  );
}
