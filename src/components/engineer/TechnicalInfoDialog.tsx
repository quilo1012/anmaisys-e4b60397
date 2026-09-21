import { useRef, useState } from "react";
import { BookOpen, Plus, Trash2, FileDown, QrCode, Columns3, Rows3, FileText, ExternalLink, ChevronDown } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { dialogTitleResponsive } from "@/components/ResponsiveDialogShell";
import {
  DEFAULT_TABLE_COLUMNS,
  exportTopicQrLabelPDF,
  exportTopicSheetPDF,
  padRow,
  topicQrDataUrl,
  topicUrl,
  type TechnicalTopic,
} from "@/lib/technicalInfo";
import {
  technicalDocUrl,
  useCreateTechnicalTopic,
  useDeleteTechnicalTopic,
  useSaveTechnicalTopic,
  useTechnicalTopics,
} from "@/hooks/useTechnicalInfo";

/**
 * Technical information for the shop floor: procedures kept as collapsible topics —
 * editable tables (rows and columns) and PDF documents such as machine manuals.
 * Printed sheets and QR labels point at the topic's own page, so a scan always shows
 * the current information rather than a frozen copy.
 */
export function TechnicalInfoDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: topics = [], isLoading } = useTechnicalTopics();
  const save = useSaveTechnicalTopic();
  const create = useCreateTechnicalTopic();
  const remove = useDeleteTechnicalTopic();
  const [qr, setQr] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const patch = (topic: TechnicalTopic, fields: Partial<TechnicalTopic>) => {
    setQr((q) => ({ ...q, [topic.id]: "" }));
    save.mutate({ id: topic.id, ...fields });
  };

  const setCell = (topic: TechnicalTopic, rowIdx: number, colIdx: number, value: string) => {
    const rows = topic.rows.map((r, i) =>
      i === rowIdx ? padRow(r, topic.columns.length).map((c, j) => (j === colIdx ? value : c)) : r,
    );
    patch(topic, { rows });
  };

  const addColumn = (topic: TechnicalTopic) =>
    patch(topic, {
      columns: [...topic.columns, `Column ${topic.columns.length + 1}`],
      rows: topic.rows.map((r) => [...padRow(r, topic.columns.length), ""]),
    });

  const removeColumn = (topic: TechnicalTopic, colIdx: number) =>
    patch(topic, {
      columns: topic.columns.filter((_, i) => i !== colIdx),
      rows: topic.rows.map((r) => padRow(r, topic.columns.length).filter((_, i) => i !== colIdx)),
    });

  const showQr = async (topic: TechnicalTopic) => {
    try {
      setQr((q) => ({ ...q, [topic.id]: await topicQrDataUrl(topic.id) }));
    } catch {
      toast.error("Could not build the QR code.");
    }
  };

  const openDoc = async (topic: TechnicalTopic) => {
    try {
      window.open(await technicalDocUrl(topic.file_path!), "_blank", "noopener");
    } catch {
      toast.error("Could not open the document.");
    }
  };

  const addTable = () =>
    create.mutate(
      { title: "New table", kind: "table", columns: DEFAULT_TABLE_COLUMNS },
      { onSuccess: () => toast.success("Table added — rename it and fill it in."), onError: (e: any) => toast.error(e.message) },
    );

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    create.mutate(
      { title: file.name.replace(/\.pdf$/i, ""), kind: "pdf", file },
      { onSuccess: () => toast.success("Document added."), onError: (err: any) => toast.error(err.message) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[98vw] max-w-[98vw] max-h-[92vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className={dialogTitleResponsive}>
            <BookOpen className="h-5 w-5 text-primary" /> Technical Info
          </DialogTitle>
          <DialogDescription>
            Machine procedures, reference tables and manuals. Print a sheet or a QR label to fix on the machine — scanning
            it opens this information in the Engineer Console.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="gap-1">
                <Plus className="h-4 w-4" /> Add information <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={addTable}>
                <Rows3 className="mr-2 h-4 w-4" /> New table
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => fileRef.current?.click()}>
                <FileText className="mr-2 h-4 w-4" /> PDF document (manual)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={onPickFile} />
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading topics…</p>
        ) : topics.length === 0 ? (
          <p className="text-sm text-muted-foreground">No topics yet — add a table or a PDF document.</p>
        ) : (
          <Accordion type="single" collapsible defaultValue={topics[0]?.id} className="w-full">
            {topics.map((topic) => (
              <AccordionItem key={topic.id} value={topic.id}>
                <AccordionTrigger className="text-left">
                  <span className="flex items-center gap-2">
                    {topic.kind === "pdf" ? <FileText className="h-4 w-4 text-muted-foreground" /> : null}
                    {topic.title}
                  </span>
                </AccordionTrigger>
                <AccordionContent className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      value={topic.title}
                      onChange={(e) => patch(topic, { title: e.target.value })}
                      aria-label="Topic title"
                      className="h-10 max-w-md"
                      autoComplete="off"
                    />
                    <Input
                      value={topic.note ?? ""}
                      onChange={(e) => patch(topic, { note: e.target.value })}
                      placeholder="Note printed with the sheet (optional)"
                      aria-label="Topic note"
                      className="h-10 max-w-sm"
                      autoComplete="off"
                    />
                  </div>

                  {topic.kind === "table" ? (
                    <div className="overflow-x-auto">
                      <div className="space-y-1" style={{ minWidth: `${Math.max(topic.columns.length, 1) * 140}px` }}>
                        <div
                          className="grid items-center gap-1"
                          style={{ gridTemplateColumns: `repeat(${topic.columns.length}, minmax(0,1fr)) 2.5rem` }}
                        >
                          {topic.columns.map((c, ci) => (
                            <div key={ci} className="flex items-center gap-1">
                              <Input
                                value={c}
                                onChange={(e) =>
                                  patch(topic, { columns: topic.columns.map((x, i) => (i === ci ? e.target.value : x)) })
                                }
                                aria-label={`Column ${ci + 1} name`}
                                className="h-9 text-xs font-semibold uppercase"
                                autoComplete="off"
                              />
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-9 w-8 shrink-0 text-destructive-strong"
                                aria-label={`Delete column ${c}`}
                                onClick={() => removeColumn(topic, ci)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ))}
                          <div />
                        </div>
                        {topic.rows.map((r, ri) => (
                          <div
                            key={ri}
                            className="grid items-center gap-1"
                            style={{ gridTemplateColumns: `repeat(${topic.columns.length}, minmax(0,1fr)) 2.5rem` }}
                          >
                            {topic.columns.map((c, ci) => (
                              <Input
                                key={ci}
                                value={padRow(r, topic.columns.length)[ci]}
                                onChange={(e) => setCell(topic, ri, ci, e.target.value)}
                                aria-label={`${c} row ${ri + 1}`}
                                className="h-10 text-sm"
                                autoComplete="off"
                              />
                            ))}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-10 w-10 text-destructive-strong"
                              aria-label={`Delete row ${ri + 1}`}
                              onClick={() => patch(topic, { rows: topic.rows.filter((_, i) => i !== ri) })}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <Button variant="outline" size="sm" className="gap-1" onClick={() => openDoc(topic)}>
                      <ExternalLink className="h-4 w-4" /> Open document
                    </Button>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {topic.kind === "table" && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1"
                          onClick={() => patch(topic, { rows: [...topic.rows, padRow([], topic.columns.length)] })}
                        >
                          <Plus className="h-4 w-4" /> Add row
                        </Button>
                        <Button variant="outline" size="sm" className="gap-1" onClick={() => addColumn(topic)}>
                          <Columns3 className="h-4 w-4" /> Add column
                        </Button>
                        <Button variant="outline" size="sm" className="gap-1" onClick={() => exportTopicSheetPDF(topic)}>
                          <FileDown className="h-4 w-4" /> PDF sheet
                        </Button>
                      </>
                    )}
                    <Button variant="outline" size="sm" className="gap-1" onClick={() => showQr(topic)}>
                      <QrCode className="h-4 w-4" /> QR code
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1 text-destructive-strong"
                      onClick={() => remove.mutate(topic)}
                    >
                      <Trash2 className="h-4 w-4" /> Delete topic
                    </Button>
                  </div>

                  {qr[topic.id] && (
                    <div className="flex flex-col items-center gap-2 rounded-md border p-3">
                      <img src={qr[topic.id]} alt={`QR code for ${topic.title}`} className="h-40 w-40" />
                      <p className="text-xs text-muted-foreground text-center break-all">
                        Scanning opens {topicUrl(topic.id)}
                      </p>
                      <Button variant="outline" size="sm" className="gap-1" onClick={() => exportTopicQrLabelPDF(topic)}>
                        <FileDown className="h-4 w-4" /> Print QR label
                      </Button>
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}

        <p className="text-xs text-muted-foreground">
          Changes are saved for everyone straight away. QR labels stay valid — they always show the latest version.
        </p>
      </DialogContent>
    </Dialog>
  );
}
