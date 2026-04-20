import { useState, useEffect, useMemo } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLines } from "@/hooks/useMachines";
import { useMobileAssets, useUpsertMobileAsset, formatMobileAsset, type MobileAssetType } from "@/hooks/useMobileAssets";
import { Printer, X, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Props {
  lineId: string;
  mobileAssetId: string;
  onChange: (next: { lineId: string; mobileAssetId: string }) => void;
}

/**
 * Line-centric picker for new Work Orders.
 *  Step 1 (required): pick a production line.
 *  Step 2 (optional): mark that the problem is on a mobile asset (Printer / Bag Sealer).
 *
 * No more "machine" dropdown — fixed machines are implicit to the line.
 */
export function LinePicker({ lineId, mobileAssetId, onChange }: Props) {
  const { data: lines } = useLines();
  const { data: mobileAssets } = useMobileAssets();
  const upsertAsset = useUpsertMobileAsset();
  const [showMobile, setShowMobile] = useState(!!mobileAssetId);

  // Auto-detect "Sealer / Printer" line by name and force the mobile picker open
  const selectedLine = useMemo(
     () => (lines || []).find((l) => l.id === lineId),
    [lines, lineId]
  );
  const isSealerPrinterLine = !!selectedLine && /sealer|printer/i.test(selectedLine.name);

  useEffect(() => {
    if (isSealerPrinterLine) setShowMobile(true);
  }, [isSealerPrinterLine]);

  const printers = (mobileAssets || []).filter((a) => a.asset_type === "printer");
  const sealers = (mobileAssets || []).filter((a) => a.asset_type === "bag_sealer");

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
      onChange({ lineId, mobileAssetId: (created as any).id });
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
        <Select value={lineId} onValueChange={(v) => onChange({ lineId: v, mobileAssetId })}>
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

      {/* Step 2 — Mobile asset toggle */}
      {!showMobile && !isSealerPrinterLine && (
        <Button
          type="button"
          variant="outline"
          className="w-full h-12 justify-start gap-2"
          onClick={() => setShowMobile(true)}
        >
          <Printer className="h-4 w-4" />
          Problem with a Printer or Bag Sealer?
        </Button>
      )}

      {showMobile && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>{isSealerPrinterLine ? "Machine *" : "Machine (optional)"}</Label>
            {!isSealerPrinterLine && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => {
                  setShowMobile(false);
                  onChange({ lineId, mobileAssetId: "" });
                }}
              >
                <X className="h-3 w-3 mr-1" /> Clear
              </Button>
            )}
          </div>
          <Select
            value={mobileAssetId || undefined}
            onValueChange={(v) => onChange({ lineId, mobileAssetId: v })}
          >
            <SelectTrigger className="h-12">
              <SelectValue placeholder="Select printer or bag sealer..." />
            </SelectTrigger>
            <SelectContent>
              {printers.length === 0 && sealers.length === 0 && (
                <div className="px-2 py-3 text-sm text-muted-foreground">
                  No mobile assets registered.
                </div>
              )}
              {printers.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Printers</SelectLabel>
                  {printers.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{formatMobileAsset(a)}</SelectItem>
                  ))}
                </SelectGroup>
              )}
              {sealers.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Bag Sealers</SelectLabel>
                  {sealers.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{formatMobileAsset(a)}</SelectItem>
                  ))}
                </SelectGroup>
              )}
            </SelectContent>
          </Select>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              disabled={upsertAsset.isPending}
              onClick={() => handleAdd("printer")}
            >
              {upsertAsset.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Plus className="h-3 w-3 mr-1" />}
              Add Printer
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              disabled={upsertAsset.isPending}
              onClick={() => handleAdd("bag_sealer")}
            >
              {upsertAsset.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Plus className="h-3 w-3 mr-1" />}
              Add Bag Sealer
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
