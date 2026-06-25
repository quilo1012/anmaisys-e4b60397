import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, RefreshCw, PlayCircle, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface MapRow {
  intouch_machine_id: string;
  intouch_machine_name: string | null;
  machine_name: string | null;
  line_id: string | null;
  active: boolean;
  last_status: number | null;
  last_downtime_code: string | null;
  last_seen_at: string | null;
}

export default function IntouchMachineMapPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [polling, setPolling] = useState(false);

  const { data: mapRows = [], isLoading } = useQuery({
    queryKey: ["intouch_machine_map"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("intouch_machine_map")
        .select("*")
        .order("intouch_machine_name", { ascending: true });
      if (error) throw error;
      return data as MapRow[];
    },
  });

  const { data: lines = [] } = useQuery({
    queryKey: ["lines"],
    queryFn: async () => (await supabase.from("lines").select("id,name").order("name")).data ?? [],
  });
  const { data: machines = [] } = useQuery({
    queryKey: ["machines-names"],
    queryFn: async () => (await supabase.from("machines").select("name").order("name")).data ?? [],
  });

  const syncFromIntouch = useMutation({
    mutationFn: async () => {
      // pull the list of machines directly through a tiny edge proxy via fetch
      const { data, error } = await supabase.functions.invoke("intouch-list-machines", { body: {} });
      if (error) throw error;
      return data as Array<{ MachineID: string; MachineName: string; Active: boolean }>;
    },
    onSuccess: async (machines) => {
      const rows = machines
        .filter((m) => m.Active)
        .map((m) => ({
          intouch_machine_id: m.MachineID,
          intouch_machine_name: m.MachineName,
          active: true,
        }));
      const { error } = await supabase
        .from("intouch_machine_map")
        .upsert(rows, { onConflict: "intouch_machine_id", ignoreDuplicates: true });
      if (error) throw error;
      toast.success(`Imported ${rows.length} machines from iTouching`);
      qc.invalidateQueries({ queryKey: ["intouch_machine_map"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Sync failed"),
  });

  const updateRow = useMutation({
    mutationFn: async (patch: Partial<MapRow> & { intouch_machine_id: string }) => {
      const { error } = await supabase
        .from("intouch_machine_map")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("intouch_machine_id", patch.intouch_machine_id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["intouch_machine_map"] }),
    onError: (e: any) => toast.error(e.message ?? "Update failed"),
  });

  const runPoll = async () => {
    setPolling(true);
    try {
      const { data, error } = await supabase.functions.invoke("intouch-poll", { body: {} });
      if (error) throw error;
      const opened = data?.opened_wos?.length ?? 0;
      toast.success(`Poll done — polled ${data?.polled ?? 0} machines, opened ${opened} WO(s)`);
    } catch (e: any) {
      toast.error(e.message ?? "Poll failed");
    } finally {
      setPolling(false);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")} className="-ml-2">
        <ArrowLeft className="h-4 w-4 mr-2" /> Back to Dashboard
      </Button>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">iTouching Machine Mapping</h1>
          <p className="text-sm text-muted-foreground">
            Link iTouching machines to internal machines/lines. Required before the poller can open WOs.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => syncFromIntouch.mutate()} disabled={syncFromIntouch.isPending}>
            {syncFromIntouch.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-2">Import from iTouching</span>
          </Button>
          <Button onClick={runPoll} disabled={polling}>
            {polling ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
            <span className="ml-2">Run poll now</span>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Mapped machines ({mapRows.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center p-6"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : mapRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No machines yet — click <b>Import from iTouching</b>.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="p-2">iTouching machine</th>
                    <th className="p-2">→ Our machine</th>
                    <th className="p-2">Line</th>
                    <th className="p-2">Last status</th>
                    <th className="p-2">Active</th>
                  </tr>
                </thead>
                <tbody>
                  {mapRows.map((r) => (
                    <tr key={r.intouch_machine_id} className="border-b">
                      <td className="p-2">
                        <div className="font-medium">{r.intouch_machine_name ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{r.intouch_machine_id}</div>
                      </td>
                      <td className="p-2">
                        <select
                          className="w-44 rounded border bg-background px-2 py-1"
                          value={r.machine_name ?? ""}
                          onChange={(e) =>
                            updateRow.mutate({ intouch_machine_id: r.intouch_machine_id, machine_name: e.target.value || null })
                          }
                        >
                          <option value="">— none —</option>
                          {machines.map((m: any) => (
                            <option key={m.name} value={m.name}>{m.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="p-2">
                        <select
                          className="w-40 rounded border bg-background px-2 py-1"
                          value={r.line_id ?? ""}
                          onChange={(e) =>
                            updateRow.mutate({ intouch_machine_id: r.intouch_machine_id, line_id: e.target.value || null })
                          }
                        >
                          <option value="">— none —</option>
                          {lines.map((l: any) => (
                            <option key={l.id} value={l.id}>{l.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="p-2">
                        {r.last_status != null ? (
                          <Badge variant={r.last_status === 1 ? "default" : "destructive"}>
                            {r.last_status}{r.last_downtime_code ? ` · ${r.last_downtime_code.slice(0, 8)}` : ""}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-2">
                        <Switch
                          checked={r.active}
                          onCheckedChange={(v) =>
                            updateRow.mutate({ intouch_machine_id: r.intouch_machine_id, active: v })
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
