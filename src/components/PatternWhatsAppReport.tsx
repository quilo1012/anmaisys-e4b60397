import { useState } from "react";
import { Copy, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { buildPatternWhatsAppReport, patternReportRecords, type PatternReportRecord, type PatternReportScope } from "@/lib/patternWhatsAppReport";

export function PatternWhatsAppReport({ records, scope, disabled }: {
  records: PatternReportRecord[]; scope: PatternReportScope; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [selectedLines, setSelectedLines] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [copying, setCopying] = useState(false);
  const { toast } = useToast();
  const eligible = patternReportRecords(records, scope);
  const lines = [...new Set(eligible.map((r) => r.line || "—"))].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const categories = [...new Set(eligible.map((r) => r.category?.trim() || "Unspecified category"))].sort();
  const report = buildPatternWhatsAppReport(records, scope, selectedLines, selectedCategories);
  const toggle = (values: string[], value: string, checked: boolean) => checked ? [...values, value] : values.filter((v) => v !== value);

  const copy = async () => {
    setCopying(true);
    try {
      await navigator.clipboard.writeText(report);
      toast({ title: "Report copied" });
    } catch {
      toast({ title: "Could not copy report", description: "Select the preview text and copy it manually.", variant: "destructive" });
    } finally { setCopying(false); }
  };

  return <>
    <Button variant="outline" className="h-14 whitespace-normal" disabled={disabled} onClick={() => {
      setSelectedLines(lines); setSelectedCategories(categories); setOpen(true);
    }}><MessageSquare className="mr-2 h-4 w-4 shrink-0" />Generate WhatsApp Report</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>WhatsApp report</DialogTitle>
          <DialogDescription>Pattern Matrix · {scope.shiftFilter === "all" ? "Day & Night" : scope.shiftFilter}</DialogDescription>
        </DialogHeader>
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">Lines / areas</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">{lines.map((line) => <label key={line} className="flex min-h-11 items-center gap-2 text-sm">
            <Checkbox checked={selectedLines.includes(line)} onCheckedChange={(c) => setSelectedLines(toggle(selectedLines, line, c === true))} />{line}
          </label>)}</div>
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">Recorded categories</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">{categories.map((category) => <label key={category} className="flex min-h-11 items-center gap-2 text-sm">
            <Checkbox checked={selectedCategories.includes(category)} onCheckedChange={(c) => setSelectedCategories(toggle(selectedCategories, category, c === true))} />{category}
          </label>)}</div>
        </fieldset>
        {report ? <Textarea aria-label="Report preview" value={report} readOnly autoComplete="off" className="min-h-80 resize-y font-mono text-sm" />
          : <p className="py-8 text-center text-sm text-muted-foreground">No recorded downtime for this selection.</p>}
        <DialogFooter><Button className="h-14" disabled={!report || copying} onClick={copy}><Copy className="mr-2 h-4 w-4" />Copy Report</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}