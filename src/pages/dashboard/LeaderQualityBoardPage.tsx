import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, Trophy } from "lucide-react";
import { format, subDays } from "date-fns";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface QA { id: string; action_type_id: string; leader_name: string | null; line: string | null; shift: string | null; description: string | null; points: number | null; recorded_at: string }
interface ActionType { id: string; label: string; points: number }

const ALERT_THRESHOLD = 10;

export default function LeaderQualityBoardPage() {
  const [days, setDays] = useState(30);
  const [selected, setSelected] = useState<string | null>(null);
  const from = useMemo(() => format(subDays(new Date(), days), "yyyy-MM-dd"), [days]);

  const { data: types = [] } = useQuery({
    queryKey: ["quality_action_types"],
    queryFn: async () => {
      const { data, error } = await supabase.from("quality_action_types").select("id, label, points");
      if (error) throw error;
      return (data ?? []) as ActionType[];
    },
  });
  const typeMap = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);

  const { data: actions = [] } = useQuery({
    queryKey: ["leader_quality_board", from],
    queryFn: async () => {
      const { data, error } = await supabase.from("quality_actions")
        .select("id, action_type_id, leader_name, line, shift, description, points, recorded_at")
        .gte("recorded_at", from)
        .order("recorded_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as QA[];
    },
  });

  const board = useMemo(() => {
    const m = new Map<string, { leader: string; points: number; issues: number }>();
    for (const a of actions) {
      if (!a.leader_name) continue;
      const cur = m.get(a.leader_name) ?? { leader: a.leader_name, points: 0, issues: 0 };
      cur.points += a.points ?? 0;
      cur.issues += 1;
      m.set(a.leader_name, cur);
    }
    return Array.from(m.values()).sort((a, b) => a.points - b.points);
  }, [actions]);

  const alerted = board.filter((b) => b.points >= ALERT_THRESHOLD);

  const trend = useMemo(() => {
    const m = new Map<string, number>();
    for (let i = days - 1; i >= 0; i--) {
      m.set(format(subDays(new Date(), i), "yyyy-MM-dd"), 0);
    }
    for (const a of actions) {
      const d = format(new Date(a.recorded_at), "yyyy-MM-dd");
      if (m.has(d)) m.set(d, (m.get(d) ?? 0) + (a.points ?? 0));
    }
    return Array.from(m.entries()).map(([date, points]) => ({ date: format(new Date(date), "dd/MM"), points }));
  }, [actions, days]);

  const selectedActions = useMemo(() => selected ? actions.filter((a) => a.leader_name === selected) : [], [actions, selected]);

  const medal = (i: number) => i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`;

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-bold">Leader Quality Board</h1>
          <div className="flex gap-2">
            {[7, 30, 90].map((d) => (
              <Badge key={d} variant={days === d ? "default" : "outline"} className="cursor-pointer" onClick={() => setDays(d)}>{d}d</Badge>
            ))}
          </div>
        </div>

        {alerted.length > 0 && (
          <Card className="border-destructive">
            <CardContent className="p-4 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
              <div>
                <div className="font-semibold text-destructive">Attention required</div>
                <div className="text-sm text-muted-foreground">
                  {alerted.map((a) => `${a.leader} (${a.points}p)`).join(", ")} reached the {ALERT_THRESHOLD}+ point threshold.
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Trophy className="h-5 w-5" />Leaderboard (fewest points first)</CardTitle></CardHeader>
          <CardContent>
            <div className="divide-y">
              {board.length === 0 && <div className="py-4 text-muted-foreground text-center">No data</div>}
              {board.map((b, i) => (
                <button key={b.leader} onClick={() => setSelected(b.leader)} className="w-full flex items-center justify-between py-3 hover:bg-muted/40 px-2 rounded text-left">
                  <div className="flex items-center gap-3">
                    <span className="text-lg w-10">{medal(i)}</span>
                    <span className="font-medium">{b.leader}</span>
                    {b.points >= ALERT_THRESHOLD && <Badge variant="destructive">Alert</Badge>}
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-muted-foreground">{b.issues} issues</span>
                    <span className={`font-bold ${b.points >= ALERT_THRESHOLD ? "text-destructive" : b.points >= 5 ? "text-amber-500" : "text-green-500"}`}>{b.points} pts</span>
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Trend (last {days} days)</CardTitle></CardHeader>
          <CardContent style={{ height: 260 }}>
            <ResponsiveContainer>
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="points" stroke="hsl(var(--primary))" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
          <DialogContent className="max-w-3xl">
            <DialogHeader><DialogTitle>{selected} — issue history</DialogTitle></DialogHeader>
            <div className="max-h-[60vh] overflow-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead>Points</TableHead><TableHead>Line</TableHead><TableHead>Shift</TableHead><TableHead>Notes</TableHead></TableRow></TableHeader>
                <TableBody>
                  {selectedActions.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No issues</TableCell></TableRow>}
                  {selectedActions.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>{format(new Date(a.recorded_at), "dd/MM HH:mm")}</TableCell>
                      <TableCell>{typeMap.get(a.action_type_id)?.label ?? "—"}</TableCell>
                      <TableCell>{a.points ?? 0}</TableCell>
                      <TableCell>{a.line ?? "—"}</TableCell>
                      <TableCell>{a.shift ?? "—"}</TableCell>
                      <TableCell className="max-w-xs truncate">{a.description ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
