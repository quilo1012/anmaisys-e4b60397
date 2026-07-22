import { useMemo, useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Loader2, Trash2, Camera, X, PenLine } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useRole } from "@/hooks/useRole";
import { compressImage } from "@/hooks/useWOPhotos";
import { getQualityPhotoUrl } from "@/hooks/useQualityIssue";

const AUDIT_TYPES = [
  { value: "internal", label: "Internal" },
  { value: "external", label: "External" },
  { value: "supplier", label: "Supplier" },
  { value: "customer", label: "Customer" },
  { value: "process", label: "Process" },
];
const AUDIT_STATUSES = [
  { value: "planned", label: "Planned", badge: "bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/40" },
  { value: "in_progress", label: "In progress", badge: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/40" },
  { value: "completed", label: "Completed", badge: "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/40" },
];
const AUDIT_RESULTS = [
  { value: "pass", label: "Pass", badge: "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/40" },
  { value: "conditional", label: "Conditional", badge: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/40" },
  { value: "fail", label: "Fail", badge: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/40" },
];
const ITEM_RESULTS = [
  { value: "conform", label: "Conform", cls: "border-green-500 bg-green-500/15 text-green-600" },
  { value: "nonconform", label: "Non-conform", cls: "border-red-500 bg-red-500/15 text-red-600" },
  { value: "observation", label: "Observation", cls: "border-amber-500 bg-amber-500/15 text-amber-600" },
  { value: "na", label: "N/A", cls: "border-slate-400 bg-slate-400/15 text-slate-500" },
];
function meta(list: { value: string; label: string; badge?: string }[], v: string | null | undefined) {
  return list.find((x) => x.value === v) ?? null;
}

interface AuditItem { clause?: string; requirement?: string; result?: string; note?: string }
interface Audit {
  id: string; audit_no: string | null; title: string | null; audit_type: string; area: string | null;
  auditor_name: string | null; auditee_name: string | null; planned_date: string | null; performed_date: string | null;
  status: string; result: string | null; score: number | null; items: AuditItem[]; attachments: string[];
  summary: string | null; auditor_signature: string | null; auditor_signed_at: string | null;
  auditee_signature: string | null; auditee_signed_at: string | null;
}

interface AuditForm {
  id?: string; audit_no: string; title: string; audit_type: string; area: string;
  auditor_name: string; auditee_name: string; planned_date: string; performed_date: string;
  status: string; result: string; score: string; summary: string; items: AuditItem[]; attachments: string[];
  auditor_signature: string; auditor_signed_at: string | null;
  auditee_signature: string; auditee_signed_at: string | null;
}
function blank(): AuditForm {
  return {
    audit_no: "", title: "", audit_type: "internal", area: "", auditor_name: "", auditee_name: "",
    planned_date: format(new Date(), "yyyy-MM-dd"), performed_date: "", status: "planned", result: "", score: "",
    summary: "", items: [], attachments: [], auditor_signature: "", auditor_signed_at: null, auditee_signature: "", auditee_signed_at: null,
  };
}
function toForm(a: Audit): AuditForm {
  return {
    id: a.id, audit_no: a.audit_no ?? "", title: a.title ?? "", audit_type: a.audit_type ?? "internal", area: a.area ?? "",
    auditor_name: a.auditor_name ?? "", auditee_name: a.auditee_name ?? "", planned_date: a.planned_date ?? "", performed_date: a.performed_date ?? "",
    status: a.status ?? "planned", result: a.result ?? "", score: a.score == null ? "" : String(a.score), summary: a.summary ?? "",
    items: Array.isArray(a.items) ? a.items.map((i) => ({ ...i })) : [], attachments: a.attachments ?? [],
    auditor_signature: a.auditor_signature ?? "", auditor_signed_at: a.auditor_signed_at, auditee_signature: a.auditee_signature ?? "", auditee_signed_at: a.auditee_signed_at,
  };
}

function AuditPhoto({ path, canDelete, onDelete }: { path: string; canDelete: boolean; onDelete: () => void }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let ok = true;
    getQualityPhotoUrl(path).then((u) => { if (ok) setUrl(u); });
    return () => { ok = false; };
  }, [path]);
  return (
    <div className="group relative aspect-square overflow-hidden rounded border bg-muted">
      {url ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="Audit attachment" className="h-full w-full object-cover" /></a>
        : <div className="flex h-full items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>}
      {canDelete && (
        <button type="button" onClick={onDelete} className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white opacity-0 transition-opacity group-hover:opacity-100">
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

export function AuditsView() {
  const { user } = useAuth();
  const { can } = useRole();
  const canManage = can("quality.manage");
  const qc = useQueryClient();

  const [filterStatus, setFilterStatus] = useState("__all__");
  const [filterType, setFilterType] = useState("__all__");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<AuditForm>(() => blank());
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: audits = [] } = useQuery({
    queryKey: ["audits"],
    queryFn: async () => {
      const { data, error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types yet
        .from("audits" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Audit[];
    },
  });

  const filtered = useMemo(() =>
    audits.filter((a) =>
      (filterStatus === "__all__" || a.status === filterStatus) &&
      (filterType === "__all__" || a.audit_type === filterType)),
    [audits, filterStatus, filterType]
  );

  const kpis = useMemo(() => ({
    total: filtered.length,
    planned: filtered.filter((a) => a.status === "planned").length,
    in_progress: filtered.filter((a) => a.status === "in_progress").length,
    ncs: filtered.reduce((sum, a) => sum + (Array.isArray(a.items) ? a.items.filter((i) => i.result === "nonconform").length : 0), 0),
  }), [filtered]);

  const newAudit = () => { setForm(blank()); setOpen(true); };
  const editAudit = (a: Audit) => { setForm(toForm(a)); setOpen(true); };

  const addItem = () => setForm((f) => ({ ...f, items: [...f.items, { clause: "", requirement: "", result: "", note: "" }] }));
  const setItem = (idx: number, patch: Partial<AuditItem>) => setForm((f) => ({ ...f, items: f.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) }));
  const removeItem = (idx: number) => setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));

  const sign = (who: "auditor" | "auditee") => setForm((f) => {
    const name = who === "auditor" ? f.auditor_name : f.auditee_name;
    if (!name.trim()) { toast.error(`Enter the ${who} name first`); return f; }
    return { ...f, [`${who}_signature`]: name.trim(), [`${who}_signed_at`]: new Date().toISOString() } as AuditForm;
  });
  const unsign = (who: "auditor" | "auditee") => setForm((f) => ({ ...f, [`${who}_signature`]: "", [`${who}_signed_at`]: null }) as AuditForm);

  const payloadFromForm = (f: AuditForm) => ({
    audit_no: f.audit_no || null, title: f.title || null, audit_type: f.audit_type, area: f.area || null,
    auditor_name: f.auditor_name || null, auditee_name: f.auditee_name || null,
    planned_date: f.planned_date || null, performed_date: f.performed_date || null,
    status: f.status, result: f.result || null, score: f.score === "" ? null : Number(f.score),
    items: f.items, summary: f.summary || null,
    auditor_signature: f.auditor_signature || null, auditor_signed_at: f.auditor_signed_at,
    auditee_signature: f.auditee_signature || null, auditee_signed_at: f.auditee_signed_at,
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload = payloadFromForm(form);
      if (form.id) {
        const { error } = await supabase
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types yet
          .from("audits" as any).update(payload as unknown as never).eq("id", form.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types yet
          .from("audits" as any).insert({ ...payload, created_by: user?.id ?? null } as unknown as never);
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["audits"] }); setOpen(false); toast.success("Audit saved"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const onPickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !form.id) return;
    setUploading(true);
    try {
      const compressed = await compressImage(file);
      const path = `audit/${form.id}/${Date.now()}.jpg`;
      const { error: upErr } = await supabase.storage.from("quality-photos").upload(path, compressed, { upsert: true });
      if (upErr) throw upErr;
      const next = [...form.attachments, path];
      const { error: dbErr } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types yet
        .from("audits" as any).update({ attachments: next } as unknown as never).eq("id", form.id);
      if (dbErr) throw dbErr;
      setForm((f) => ({ ...f, attachments: next }));
      qc.invalidateQueries({ queryKey: ["audits"] });
    } catch (err) { toast.error((err as Error).message); }
    finally { setUploading(false); }
  };

  const deletePhoto = async (path: string) => {
    if (!form.id) return;
    await supabase.storage.from("quality-photos").remove([path]);
    const next = form.attachments.filter((p) => p !== path);
    await supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types yet
      .from("audits" as any).update({ attachments: next } as unknown as never).eq("id", form.id);
    setForm((f) => ({ ...f, attachments: next }));
    qc.invalidateQueries({ queryKey: ["audits"] });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        {canManage && <Button onClick={newAudit}><Plus className="mr-1 h-4 w-4" />New audit</Button>}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Audits</div><div className="text-2xl font-bold">{kpis.total}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Planned</div><div className="text-2xl font-bold text-slate-600 dark:text-slate-300">{kpis.planned}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">In progress</div><div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{kpis.in_progress}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Non-conformities</div><div className="text-2xl font-bold text-red-600 dark:text-red-400">{kpis.ncs}</div></CardContent></Card>
      </div>

      <div className="flex flex-wrap gap-2">
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="__all__">All status</SelectItem>{AUDIT_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="__all__">All types</SelectItem>{AUDIT_TYPES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader><CardTitle>Audits ({filtered.length})</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>#</TableHead><TableHead>Title</TableHead><TableHead>Type</TableHead><TableHead>Area</TableHead>
              <TableHead>Auditor</TableHead><TableHead>Date</TableHead><TableHead>Status</TableHead><TableHead>Result</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">No audits</TableCell></TableRow>}
              {filtered.map((a) => {
                const st = meta(AUDIT_STATUSES, a.status); const rs = meta(AUDIT_RESULTS, a.result);
                const d = a.performed_date ?? a.planned_date;
                return (
                  <TableRow key={a.id} className={cn(canManage && "cursor-pointer")} onClick={() => canManage && editAudit(a)}>
                    <TableCell className="font-mono text-xs">{a.audit_no ?? "—"}</TableCell>
                    <TableCell className="max-w-[16rem] truncate">{a.title ?? "—"}</TableCell>
                    <TableCell className="capitalize">{meta(AUDIT_TYPES, a.audit_type)?.label ?? a.audit_type}</TableCell>
                    <TableCell>{a.area ?? "—"}</TableCell>
                    <TableCell>{a.auditor_name ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{d ? format(new Date(d + "T00:00:00"), "dd/MM/yyyy") : "—"}</TableCell>
                    <TableCell>{st && <Badge variant="outline" className={cn("text-[10px]", st.badge)}>{st.label}</Badge>}</TableCell>
                    <TableCell>{rs ? <Badge variant="outline" className={cn("text-[10px]", rs.badge)}>{rs.label}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>{form.id ? "Edit audit" : "New audit"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Audit #</Label><Input value={form.audit_no} onChange={(e) => setForm({ ...form, audit_no: e.target.value })} placeholder="e.g. AUD-2026-001" /></div>
              <div><Label>Type</Label>
                <Select value={form.audit_type} onValueChange={(v) => setForm({ ...form, audit_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{AUDIT_TYPES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Title</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Area / scope</Label><Input value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} /></div>
              <div><Label>Auditee</Label><Input value={form.auditee_name} onChange={(e) => setForm({ ...form, auditee_name: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Planned</Label><Input type="date" value={form.planned_date} onChange={(e) => setForm({ ...form, planned_date: e.target.value })} /></div>
              <div><Label>Performed</Label><Input type="date" value={form.performed_date} onChange={(e) => setForm({ ...form, performed_date: e.target.value })} /></div>
              <div><Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{AUDIT_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            {/* Checklist */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <Label>Checklist</Label>
                <Button size="sm" variant="outline" onClick={addItem}><Plus className="mr-1 h-4 w-4" />Add item</Button>
              </div>
              <div className="space-y-2">
                {form.items.length === 0 && <p className="text-xs text-muted-foreground">No items yet.</p>}
                {form.items.map((it, idx) => (
                  <div key={idx} className="rounded border p-2">
                    <div className="grid grid-cols-12 gap-2">
                      <Input className="col-span-3 h-8" placeholder="Clause" value={it.clause ?? ""} onChange={(e) => setItem(idx, { clause: e.target.value })} />
                      <Input className="col-span-8 h-8" placeholder="Requirement" value={it.requirement ?? ""} onChange={(e) => setItem(idx, { requirement: e.target.value })} />
                      <Button size="icon" variant="ghost" className="col-span-1 h-8 w-8 text-destructive" onClick={() => removeItem(idx)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      {ITEM_RESULTS.map((r) => {
                        const on = it.result === r.value;
                        return (
                          <button key={r.value} type="button" onClick={() => setItem(idx, { result: on ? "" : r.value })}
                            className={cn("rounded border px-2 py-0.5 text-xs transition-colors", on ? r.cls : "text-muted-foreground hover:bg-accent")}>{r.label}</button>
                        );
                      })}
                      <Input className="ml-1 h-7 flex-1 min-w-[8rem]" placeholder="Note" value={it.note ?? ""} onChange={(e) => setItem(idx, { note: e.target.value })} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Result + score */}
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Result</Label>
                <Select value={form.result || "__none__"} onValueChange={(v) => setForm({ ...form, result: v === "__none__" ? "" : v })}>
                  <SelectTrigger className={cn("border", meta(AUDIT_RESULTS, form.result)?.badge)}><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent><SelectItem value="__none__">—</SelectItem>{AUDIT_RESULTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Score (%)</Label><Input type="number" value={form.score} onChange={(e) => setForm({ ...form, score: e.target.value })} /></div>
            </div>
            <div><Label>Summary</Label><Textarea value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} /></div>

            {/* Photos */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <Label className="flex items-center gap-1"><Camera className="h-4 w-4" /> Photos ({form.attachments.length})</Label>
                {canManage && form.id && (
                  <>
                    <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickPhoto} />
                    <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
                      {uploading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Camera className="mr-1 h-4 w-4" />}Add photo
                    </Button>
                  </>
                )}
              </div>
              {!form.id ? <p className="text-xs text-muted-foreground">Save the audit first to attach photos.</p>
                : form.attachments.length === 0 ? <p className="text-xs text-muted-foreground">No photos.</p>
                : <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{form.attachments.map((p) => <AuditPhoto key={p} path={p} canDelete={canManage} onDelete={() => deletePhoto(p)} />)}</div>}
            </div>

            {/* Signatures */}
            <div className="grid grid-cols-2 gap-3">
              {(["auditor", "auditee"] as const).map((who) => {
                const sigName = who === "auditor" ? form.auditor_signature : form.auditee_signature;
                const sigAt = who === "auditor" ? form.auditor_signed_at : form.auditee_signed_at;
                const nameVal = who === "auditor" ? form.auditor_name : form.auditee_name;
                return (
                  <div key={who} className="rounded border p-2">
                    <Label className="capitalize">{who}</Label>
                    <Input className="mt-1 h-8" value={nameVal} placeholder={`${who} name`}
                      onChange={(e) => setForm({ ...form, [`${who}_name`]: e.target.value } as unknown as AuditForm)} />
                    {sigAt ? (
                      <div className="mt-1.5 flex items-center justify-between text-xs">
                        <span className="text-green-600 dark:text-green-400">✓ {sigName} · {format(new Date(sigAt), "dd/MM/yyyy HH:mm")}</span>
                        <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => unsign(who)}>clear</button>
                      </div>
                    ) : (
                      <Button size="sm" variant="outline" className="mt-1.5" onClick={() => sign(who)}><PenLine className="mr-1 h-3.5 w-3.5" />Sign</Button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <DialogFooter><Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
