// src/components/EngineerDashboardView.tsx
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Hammer, Clock, CheckCircle2, Factory } from "lucide-react";

type WO = {
  id: string;
  wo_number: string | null;
  line_id: string | null;
  problem_description: string | null;
  status: string;
  created_at: string;
  lines?: { name: string | null } | null;
};

export function EngineerDashboardView() {
  const { data: allOrders, isLoading } = useQuery<WO[]>({
    queryKey: ["engineer_all_orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_orders")
        .select("id, wo_number, line_id, problem_description, status, created_at, lines(name)")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as WO[];
    },
    refetchInterval: 30_000,
  });

  const openOrders = allOrders?.filter((o) => o.status === "open") ?? [];
  const inProgressOrders =
    allOrders?.filter((o) => ["received", "arrived", "in_progress"].includes(o.status)) ?? [];
  const completedOrders =
    allOrders?.filter((o) =>
      ["closed", "finished", "completed", "force_closed"].includes(o.status),
    ) ?? [];

  if (isLoading) {
    return <div className="p-6 text-muted-foreground">Carregando ordens da engenharia...</div>;
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Factory className="h-6 w-6 text-primary" />
          Central de Manutenção & Engenharia
        </h1>
        <p className="text-muted-foreground text-sm">
          Monitorização em tempo real de ordens de serviço de todas as linhas.
        </p>
      </div>

      <Tabs defaultValue="open" className="w-full">
        <TabsList>
          <TabsTrigger value="open">Open ({openOrders.length})</TabsTrigger>
          <TabsTrigger value="in_progress">In Progress ({inProgressOrders.length})</TabsTrigger>
          <TabsTrigger value="completed">Finalizadas ({completedOrders.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="open">
          <OrderTable list={openOrders} icon={<Hammer className="h-4 w-4 text-amber-500" />} />
        </TabsContent>
        <TabsContent value="in_progress">
          <OrderTable list={inProgressOrders} icon={<Clock className="h-4 w-4 text-blue-500" />} />
        </TabsContent>
        <TabsContent value="completed">
          <OrderTable
            list={completedOrders}
            icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function OrderTable({ list, icon }: { list: WO[]; icon: React.ReactNode }) {
  if (list.length === 0) {
    return (
      <div className="p-6 text-center text-muted-foreground border rounded-md">
        Nenhuma ordem neste estado.
      </div>
    );
  }

  return (
    <div className="border rounded-md">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nº Ordem</TableHead>
            <TableHead>Linha</TableHead>
            <TableHead>Descrição da Ocorrência / Falha</TableHead>
            <TableHead>Estado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.map((o) => (
            <TableRow key={o.id}>
              <TableCell className="font-medium flex items-center gap-2">
                {icon} {o.wo_number || `#${o.id.slice(0, 5)}`}
              </TableCell>
              <TableCell>{o.lines?.name ?? "—"}</TableCell>
              <TableCell>{o.problem_description ?? "—"}</TableCell>
              <TableCell>
                <Badge variant="outline">{o.status.toUpperCase()}</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
