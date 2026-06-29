import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2, Loader2, Save } from "lucide-react";
import { useNavigate } from "react-router-dom";

type Row = {
  id: string;
  stop_code: string;
  label: string;
  default_priority: string;
  category: string | null;
  line_hint: string | null;
  requires_wo: boolean;
  active: boolean;
};

const PRIORITIES = ["low", "medium", "high", "critical"];
const CATEGORIES = ["Mechanical", "Electrical", "Machine", "Maintenance", "Filler", "Other"];

export default function IntouchStopCodesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Record<string, Partial<Row>>>({});

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["intouch_stop_code_map"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("intouch_stop_code_map")
        .select("*")
        .order("stop_code", { ascending: true });
      if (error) throw error;
      return data as Row[];
    },
  });

  const { data: lines = [] } = useQuery({
    queryKey: ["lines-for-stopcodes"],
    queryFn: async () => {
      const { data, error } = await supabase.from("lines").select("id, name").order("name");
      if (error) throw error;
      return data as { id: string; name: string }[];
    },
  });

  const upsert = useMutation({
    mutationFn: async (row: Partial<Row>) => {
      const payload: any = { ...row };
      if (!payload.stop_code?.trim()) throw new Error("Stop code is required");
      if (!payload.label?.trim()) throw new Error("Label is required");
      if (!payload.default_priority) payload.default_priority = "medium";
      const { error } = await supabase.from("intouch_stop_code_map").upsert(payload, {
        onConflict: "stop_code",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Saved");
      setDraft({});
      qc.invalidateQueries({ queryKey: ["intouch_stop_code_map"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to save"),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("intouch_stop_code_map").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["intouch_stop_code_map"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to delete"),
  });

  const patch = (id: string, p: Partial<Row>) =>
    setDraft((d) => ({ ...d, [id]: { ...d[id], ...p } }));

  const merged = (r: Row) => ({ ...r, ...(draft[r.id] ?? {}) });

  const [newRow, setNewRow] = useState<Partial<Row>>({
    stop_code: "", label: "", default_priority: "medium",
    category: "Other", line_hint: null, requires_wo: true, active: true,
  });

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>
        <h1 className="text-2xl font-bold">iTouching Stop Codes Mapping</h1>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Add new mapping</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-7 gap-2 items-end">
          <Input placeholder="Stop code" value={newRow.stop_code ?? ""}
            onChange={(e) => setNewRow({ ...newRow, stop_code: e.target.value })} />
          <Input className="md:col-span-2" placeholder="Label / description" value={newRow.label ?? ""}
            onChange={(e) => setNewRow({ ...newRow, label: e.target.value })} />
          <Select value={newRow.default_priority} onValueChange={(v) => setNewRow({ ...newRow, default_priority: v })}>
            <SelectTrigger><SelectValue placeholder="Priority" /></SelectTrigger>
            <SelectContent>{PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={newRow.category ?? "Other"} onValueChange={(v) => setNewRow({ ...newRow, category: v })}>
            <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={newRow.line_hint ?? "none"} onValueChange={(v) => setNewRow({ ...newRow, line_hint: v === "none" ? null : v })}>
            <SelectTrigger><SelectValue placeholder="Line (optional)" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Any line</SelectItem>
              {lines.map((l) => <SelectItem key={l.id} value={l.name}>{l.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={() => upsert.mutate(newRow)} disabled={upsert.isPending}>
            <Plus className="w-4 h-4 mr-1" /> Add
          </Button>
          <div className="md:col-span-7 flex items-center gap-4 text-sm">
            <label className="flex items-center gap-2">
              <Switch checked={newRow.requires_wo ?? true}
                onCheckedChange={(v) => setNewRow({ ...newRow, requires_wo: v })} />
              Creates Work Order
            </label>
            <label className="flex items-center gap-2">
              <Switch checked={newRow.active ?? true}
                onCheckedChange={(v) => setNewRow({ ...newRow, active: v })} />
              Active
            </label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Existing mappings ({rows.length})</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">Code</TableHead>
                    <TableHead>Label</TableHead>
                    <TableHead className="w-32">Priority</TableHead>
                    <TableHead className="w-36">Category</TableHead>
                    <TableHead className="w-40">Line hint</TableHead>
                    <TableHead className="w-24 text-center">WO</TableHead>
                    <TableHead className="w-24 text-center">Active</TableHead>
                    <TableHead className="w-32"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const m = merged(r);
                    const dirty = !!draft[r.id];
                    return (
                      <TableRow key={r.id}>
                        <TableCell>
                          <Input value={m.stop_code}
                            onChange={(e) => patch(r.id, { stop_code: e.target.value })} />
                        </TableCell>
                        <TableCell>
                          <Input value={m.label}
                            onChange={(e) => patch(r.id, { label: e.target.value })} />
                        </TableCell>
                        <TableCell>
                          <Select value={m.default_priority}
                            onValueChange={(v) => patch(r.id, { default_priority: v })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>{PRIORITIES.map((p) =>
                              <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            list="category-options"
                            value={m.category ?? ""}
                            placeholder="Category"
                            onChange={(e) => patch(r.id, { category: e.target.value || null })}
                          />
                        </TableCell>
                        <TableCell>
                          <Select value={m.line_hint ?? "none"}
                            onValueChange={(v) => patch(r.id, { line_hint: v === "none" ? null : v })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Any line</SelectItem>
                              {lines.map((l) => <SelectItem key={l.id} value={l.name}>{l.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-center">
                          <Switch checked={m.requires_wo}
                            onCheckedChange={(v) => patch(r.id, { requires_wo: v })} />
                        </TableCell>
                        <TableCell className="text-center">
                          <Switch checked={m.active}
                            onCheckedChange={(v) => patch(r.id, { active: v })} />
                        </TableCell>
                        <TableCell className="flex gap-1">
                          <Button size="sm" variant={dirty ? "default" : "ghost"}
                            disabled={!dirty || upsert.isPending}
                            onClick={() => upsert.mutate({ id: r.id, ...m })}>
                            <Save className="w-4 h-4" />
                          </Button>
                          <Button size="sm" variant="ghost"
                            onClick={() => { if (confirm("Delete this mapping?")) del.mutate(r.id); }}>
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
