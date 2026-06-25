import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface LineRow {
  id: string;
  name: string;
  active: boolean;
  display_order: number | null;
}

export function ManageLinesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [newName, setNewName] = useState("");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["manage-lines"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lines")
        .select("id,name,active,display_order")
        .order("name");
      if (error) throw error;
      return (data ?? []) as LineRow[];
    },
    enabled: open,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["manage-lines"] });
    qc.invalidateQueries({ queryKey: ["rag-lines"] });
  };

  const toggle = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from("lines").update({ active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const create = useMutation({
    mutationFn: async (name: string) => {
      const clean = name.trim();
      if (!clean) throw new Error("Name required");
      const { error } = await supabase.from("lines").insert({ name: clean, active: true });
      if (error) throw error;
    },
    onSuccess: () => {
      setNewName("");
      invalidate();
      toast.success("Line added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("lines").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Line deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Manage Lines</DialogTitle>
        </DialogHeader>

        <div className="flex gap-2">
          <Input
            placeholder="New line name (e.g. Line 7)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") create.mutate(newName);
            }}
          />
          <Button onClick={() => create.mutate(newName)} disabled={create.isPending || !newName.trim()}>
            <Plus className="h-4 w-4 mr-1" />Add
          </Button>
        </div>

        <div className="max-h-[400px] overflow-y-auto divide-y border rounded-md">
          {isLoading && <div className="p-3 text-sm text-muted-foreground">Loading…</div>}
          {!isLoading && rows.length === 0 && (
            <div className="p-3 text-sm text-muted-foreground">No lines yet.</div>
          )}
          {rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="font-medium truncate">{r.name}</span>
              <div className="flex items-center gap-3 shrink-0">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={r.active}
                    onCheckedChange={(v) => toggle.mutate({ id: r.id, active: v })}
                  />
                  <span className="text-xs text-muted-foreground w-12">
                    {r.active ? "Active" : "Inactive"}
                  </span>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    if (confirm(`Delete line "${r.name}"? This cannot be undone.`)) remove.mutate(r.id);
                  }}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
