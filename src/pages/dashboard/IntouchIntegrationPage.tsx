import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Copy, RefreshCw, Trash2 } from "lucide-react";

interface WebhookLog {
  id: string;
  received_at: string;
  parsed_ok: boolean;
  error_message: string | null;
  created_wo_id: string | null;
  payload: any;
}

interface StopCode {
  id: string;
  stop_code: string;
  label: string;
  default_priority: string;
  category: string | null;
  active: boolean;
}

export default function IntouchIntegrationPage() {
  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [codes, setCodes] = useState<StopCode[]>([]);
  const [loading, setLoading] = useState(false);
  const [newCode, setNewCode] = useState({ stop_code: "", label: "", default_priority: "medium" });

  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const webhookUrl = `https://${projectId}.supabase.co/functions/v1/intouch-webhook`;

  async function load() {
    setLoading(true);
    const [{ data: l }, { data: c }] = await Promise.all([
      supabase.from("intouch_webhook_logs").select("*").order("received_at", { ascending: false }).limit(50),
      supabase.from("intouch_stop_code_map").select("*").order("stop_code"),
    ]);
    setLogs((l as any) ?? []);
    setCodes((c as any) ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function addCode() {
    if (!newCode.stop_code || !newCode.label) return;
    const { error } = await supabase.from("intouch_stop_code_map").insert(newCode);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setNewCode({ stop_code: "", label: "", default_priority: "medium" });
    load();
  }

  async function removeCode(id: string) {
    await supabase.from("intouch_stop_code_map").delete().eq("id", id);
    load();
  }

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Intouch i4 Integration</h1>
          <p className="text-muted-foreground text-sm">
            Receive line-stop events from Intouch i4 and create work orders automatically.
          </p>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-lg">Webhook endpoint</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="flex gap-2">
              <Input readOnly value={webhookUrl} className="font-mono text-xs" />
              <Button variant="outline" size="icon" onClick={() => { navigator.clipboard.writeText(webhookUrl); toast({ title: "Copied" }); }}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Configure Intouch to POST JSON to this URL with header <code>x-intouch-signature: &lt;your INTOUCH_WEBHOOK_SECRET&gt;</code>.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Stop code mapping</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <Input placeholder="Stop code (e.g. E12)" value={newCode.stop_code} onChange={(e) => setNewCode({ ...newCode, stop_code: e.target.value })} />
              <Input placeholder="Label / problem" value={newCode.label} onChange={(e) => setNewCode({ ...newCode, label: e.target.value })} />
              <select className="h-10 rounded-md border bg-background px-3 text-sm" value={newCode.default_priority} onChange={(e) => setNewCode({ ...newCode, default_priority: e.target.value })}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
              <Button onClick={addCode}>Add</Button>
            </div>
            <Table>
              <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Label</TableHead><TableHead>Priority</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {codes.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono">{c.stop_code}</TableCell>
                    <TableCell>{c.label}</TableCell>
                    <TableCell><Badge variant="secondary">{c.default_priority}</Badge></TableCell>
                    <TableCell className="text-right"><Button variant="ghost" size="icon" onClick={() => removeCode(c.id)}><Trash2 className="h-4 w-4" /></Button></TableCell>
                  </TableRow>
                ))}
                {!codes.length && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground text-sm">No codes mapped yet.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Recent webhook calls</CardTitle>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}><RefreshCw className="h-4 w-4 mr-1" /> Refresh</Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {logs.map((l) => (
                <div key={l.id} className="border rounded-md p-3 text-xs">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-muted-foreground">{new Date(l.received_at).toLocaleString()}</span>
                    {l.parsed_ok
                      ? <Badge className="bg-emerald-500/15 text-emerald-600">Parsed ✓</Badge>
                      : <Badge variant="destructive">{l.error_message ?? "Unparsed"}</Badge>}
                  </div>
                  <pre className="bg-muted/30 p-2 rounded overflow-x-auto max-h-48">{JSON.stringify(l.payload, null, 2)}</pre>
                </div>
              ))}
              {!logs.length && <p className="text-sm text-muted-foreground text-center py-8">No webhook calls received yet.</p>}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
