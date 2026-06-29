// src/components/TabletProductionView.tsx
import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Target, BarChart3, ShoppingCart, Lock } from "lucide-react";
import { format } from "date-fns";

type SessionRow = {
  id: string;
  locked: boolean | null;
  notes: string | null;
  leader_name: string | null;
  production_items: { actual_qty: number | null }[] | null;
};

type WORow = {
  id: string;
  wo_number: string | null;
  problem_description: string | null;
  status: string;
  created_at: string;
};

export function TabletProductionView() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [operatorName, setOperatorName] = useState("");
  const [operatorNotes, setOperatorNotes] = useState("");

  // Strict line lock from email: lineN@... -> "Filler Line N"
  const detectedLine = useMemo(() => {
    const email = user?.email?.toLowerCase() ?? "";
    const m = email.match(/line(\d+)/);
    return m ? `Filler Line ${m[1]}` : "Filler Line 1";
  }, [user?.email]);

  const currentDate = format(new Date(), "yyyy-MM-dd");
  const currentHour = new Date().getHours();
  const currentShift: "DAY" | "NIGHT" =
    currentHour >= 6 && currentHour < 18 ? "DAY" : "NIGHT";

  const { data: sessionData, isLoading: loadingSession } = useQuery<SessionRow | null>({
    queryKey: ["tablet_session", detectedLine, currentDate, currentShift],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("production_sessions")
        .select("id, locked, notes, leader_name, production_items(actual_qty)")
        .eq("line", detectedLine)
        .eq("session_date", currentDate)
        .eq("shift", currentShift)
        .maybeSingle();
      if (error) throw error;
      return (data as SessionRow) ?? null;
    },
    refetchInterval: 30_000,
  });

  const { data: ragData } = useQuery<{ plan_qty: number | null } | null>({
    queryKey: ["tablet_rag", detectedLine, currentDate, currentShift],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("rag_weekly_entries")
        .select("plan_qty")
        .eq("line", detectedLine)
        .eq("entry_date", currentDate)
        .eq("shift", currentShift)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
    refetchInterval: 30_000,
  });

  const { data: requestOrders, isLoading: loadingOrders } = useQuery<WORow[]>({
    queryKey: ["tablet_requests", detectedLine],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("work_orders")
        .select("id, wo_number, problem_description, status, created_at")
        .eq("line_at_time", detectedLine)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return ((data ?? []) as WORow[]);
    },
    refetchInterval: 30_000,
  });

  const totalTarget = ragData?.plan_qty ?? 0;
  const totalActual =
    sessionData?.production_items?.reduce(
      (s, i) => s + (i.actual_qty ?? 0),
      0,
    ) ?? 0;
  const efficiency =
    totalTarget > 0 ? Math.round((totalActual / totalTarget) * 100) : 0;

  useEffect(() => {
    if (sessionData?.notes) setOperatorNotes(sessionData.notes);
    if (sessionData?.leader_name) setOperatorName(sessionData.leader_name);
  }, [sessionData]);

  const submitShiftMutation = useMutation({
    mutationFn: async () => {
      if (!sessionData?.id) throw new Error("Nenhuma sessão ativa para este turno.");
      const { error } = await (supabase as any)
        .from("production_sessions")
        .update({ leader_name: operatorName, notes: operatorNotes })
        .eq("id", sessionData.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Dados sincronizados com sucesso!");
      qc.invalidateQueries({ queryKey: ["tablet_session"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (loadingSession || loadingOrders) {
    return (
      <div className="p-6 text-muted-foreground">
        Carregando painel fixo do tablet...
      </div>
    );
  }

  const locked = !!sessionData?.locked;

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between rounded-lg border bg-card p-4">
        <div>
          <div className="text-2xl font-bold flex items-center gap-2">
            <Lock className="h-5 w-5 text-primary" />
            {detectedLine.toUpperCase()}
          </div>
          <div className="text-xs text-muted-foreground">
            {user?.email} · TURNO {currentShift} · {currentDate}
          </div>
        </div>
        <Badge>TABLET FIXO</Badge>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border bg-card p-4 text-center">
          <Target className="h-5 w-5 mx-auto text-primary" />
          <div className="text-2xl font-bold">{totalTarget.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground">Target RAG</div>
        </div>
        <div className="rounded-lg border bg-card p-4 text-center">
          <BarChart3 className="h-5 w-5 mx-auto text-primary" />
          <div className="text-2xl font-bold">{totalActual.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground">Current Shift</div>
        </div>
        <div className="rounded-lg border bg-card p-4 text-center">
          <div className="text-lg">⚡</div>
          <div
            className={`text-2xl font-bold ${
              efficiency >= 80 ? "text-emerald-500" : "text-amber-500"
            }`}
          >
            {efficiency}%
          </div>
          <div className="text-xs text-muted-foreground">Eficiência</div>
        </div>
      </div>

      <div className="rounded-lg border bg-card">
        <div className="flex items-center gap-2 p-4 border-b">
          <ShoppingCart className="h-4 w-4" />
          <h2 className="font-semibold">Request Orders ({detectedLine})</h2>
        </div>
        {!requestOrders?.length ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            Nenhuma ordem requisitada para esta linha.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nº Ordem</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requestOrders.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">
                    {o.wo_number || `#${o.id.slice(0, 5)}`}
                  </TableCell>
                  <TableCell>{o.problem_description ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{o.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <div className="rounded-lg border bg-card p-4 space-y-4">
        <div className="space-y-2">
          <Label>Operador Responsável</Label>
          <Input
            value={operatorName}
            onChange={(e) => setOperatorName(e.target.value)}
            placeholder="Seu Nome"
            disabled={locked}
          />
        </div>
        <div className="space-y-2">
          <Label>Diário / Ocorrências na Linha</Label>
          <Textarea
            value={operatorNotes}
            onChange={(e) => setOperatorNotes(e.target.value)}
            placeholder="Digite aqui problemas com máquina, paragens ou atrasos..."
            rows={3}
            disabled={locked}
          />
        </div>
        {!locked ? (
          <Button
            onClick={() => submitShiftMutation.mutate()}
            disabled={submitShiftMutation.isPending}
            className="w-full font-bold"
          >
            Gravar e Sincronizar Turno
          </Button>
        ) : (
          <div className="text-xs text-center text-muted-foreground bg-muted p-2 rounded-lg">
            🔒 Turno Fechado e Bloqueado pela Administração.
          </div>
        )}
      </div>
    </div>
  );
}
