import { useMemo } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLines } from "@/hooks/useMachines";
import { useMobileAssets, useUpsertMobileAsset, formatMobileAsset, type MobileAssetType } from "@/hooks/useMobileAssets";
import { Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Props {
  lineId: string;
  mobileAssetId: string;
  /** Optional secondary asset id (used on Sealer/Printer line where both a sealer and a printer are picked). */
  secondaryAssetId?: string;
  onChange: (next: { lineId: string; mobileAssetId: string; secondaryAssetId?: string }) => void;
}

/**
 * Line-centric picker for new Work Orders.
 *  Step 1 (required): pick a production line.
 *  Step 2 (optional): mark that the problem is on a mobile asset (Printer / Bag Sealer).
 *
 * No more "machine" dropdown — fixed machines are implicit to the line.
 */
export function LinePicker({ lineId, mobileAssetId, secondaryAssetId = "", onChange }: Props) {
  const { data: lines } = useLines();
  const { data: mobileAssets } = useMobileAssets();
  const upsertAsset = useUpsertMobileAsset();

  // Auto-detect "Sealer and Printer INK" line by name to show both pickers
  const selectedLine = useMemo(
    () => (lines || []).find((l) => l.id === lineId),
    [lines, lineId]
  );
  const isSealerPrinterLine = !!selectedLine && /sealer|printer/i.test(selectedLine.name);

  const printers = (mobileAssets || []).filter((a) => a.asset_type === "printer");
  const sealers = (mobileAssets || []).filter((a) => a.asset_type === "bag_sealer");

  // On the Sealer/Printer line, mobileAssetId holds the SEALER and secondaryAssetId holds the PRINTER.
  const sealerId = isSealerPrinterLine ? mobileAssetId : "";
  const printerId = isSealerPrinterLine ? secondaryAssetId : "";

  const handleAdd = async (type: MobileAssetType) => {
    const list = type === "printer" ? printers : sealers;
    const nextNumber = (list.reduce((m, a) => Math.max(m, a.asset_number), 0) || 0) + 1;
    try {
      const created = await upsertAsset.mutateAsync({
        asset_type: type,
        asset_number: nextNumber,
        current_line_id: lineId || null,
        active: true,
      });
      const newId = (created as any).id;
      if (isSealerPrinterLine) {
        if (type === "bag_sealer") onChange({ lineId, mobileAssetId: newId, secondaryAssetId: printerId });
        else onChange({ lineId, mobileAssetId: sealerId, secondaryAssetId: newId });
      } else {
        onChange({ lineId, mobileAssetId: newId });
      }
      toast.success(`${type === "printer" ? "Printer" : "Bag Sealer"} ${nextNumber} added`);
    } catch (err: any) {
      toast.error(err.message || "Failed to add asset");
    }
  };

  return (
    <div className="space-y-4">
      {/* Step 1 — Line */}
      <div className="space-y-2">
        <Label>Line *</Label>
        <Select value={lineId} onValueChange={(v) => onChange({ lineId: v, mobileAssetId: "", secondaryAssetId: "" })}>
          <SelectTrigger className="h-12">
            <SelectValue placeholder="Select production line..." />
          </SelectTrigger>
          <SelectContent>
            {(lines || []).map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Sealer/Printer line: TWO independent selects (each sealer can pair with any printer) */}
      {isSealerPrinterLine && (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Bag Sealer *</Label>
            <Select
              value={sealerId || undefined}
              onValueChange={(v) => onChange({ lineId, mobileAssetId: v, secondaryAssetId: printerId })}
            >
              <SelectTrigger className="h-12"><SelectValue placeholder="Select sealer..." /></SelectTrigger>
              <SelectContent>
                {sealers.length === 0 && (
                  <div className="px-2 py-3 text-sm text-muted-foreground">No bag sealers registered.</div>
                )}
                {sealers.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{formatMobileAsset(a)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button" variant="outline" size="sm" className="h-9 w-full"
              disabled={upsertAsset.isPending}
              onClick={() => handleAdd("bag_sealer")}
            >
              {upsertAsset.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Plus className="h-3 w-3 mr-1" />}
              Add Bag Sealer
            </Button>
          </div>

          <div className="space-y-2">
            <Label>Printer *</Label>
            <Select
              value={printerId || undefined}
              onValueChange={(v) => onChange({ lineId, mobileAssetId: sealerId, secondaryAssetId: v })}
            >
              <SelectTrigger className="h-12"><SelectValue placeholder="Select printer..." /></SelectTrigger>
              <SelectContent>
                {printers.length === 0 && (
                  <div className="px-2 py-3 text-sm text-muted-foreground">No printers registered.</div>
                )}
                {printers.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{formatMobileAsset(a)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button" variant="outline" size="sm" className="h-9 w-full"
              disabled={upsertAsset.isPending}
              onClick={() => handleAdd("printer")}
            >
              {upsertAsset.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Plus className="h-3 w-3 mr-1" />}
              Add Printer
            </Button>
          </div>
        </div>
      )}

    </div>
  );
}
