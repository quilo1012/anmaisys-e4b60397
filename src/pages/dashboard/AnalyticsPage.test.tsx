/**
 * O cartão Leader Performance responde pelo período que o filtro diz, e por mais nenhum.
 *
 * A coluna "Open Actions" era a única figura do cartão sem limite de datas: a consulta
 * pedia todas as acções em `todo`/`in_progress` desde sempre. Num dia único de produção
 * — sete líderes, uma sessão cada — o Ailton aparecia com 2 acções e 3 pontos que tinham
 * sido levantadas a 27 e 29 de Julho, duas semanas antes do dia que o cabeçalho imprimia.
 * O mesmo líder, aberto no scorecard ao lado, mostrava zero: esse ecrã sempre limitou as
 * acções ao período. Duas telas, dois números, o mesmo líder.
 *
 * O que se fixa aqui é o contrato do cartão: uma acção fora do período não conta em
 * nenhuma das suas células, e uma acção dentro do período conta em todas.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { format, subDays } from "date-fns";

vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
// A barra de filtros restaura o período do localStorage ao montar; o teste quer o
// preset por omissão da página (30 dias) e nada mais.
vi.mock("@/components/reports/ReportsFilterBar", () => ({
  ReportsFilterBar: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1" }, profile: { name: "Manager" }, role: "manager", loading: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useWorkOrders", () => ({ useWorkOrders: () => ({ data: [], isLoading: false }) }));
vi.mock("@/hooks/useStock", () => ({
  useTotalPartsUsedToday: () => ({ data: 0 }),
  useProducts: () => ({ data: [], isLoading: false }),
}));
vi.mock("@/hooks/useMachines", () => ({
  useMachines: () => ({ data: [], isLoading: false }),
  useLines: () => ({ data: [] }),
}));
vi.mock("@/hooks/useEngineerScores", () => ({ useEngineerScores: () => ({ isLoading: false }) }));
vi.mock("@/hooks/useWoMetrics", () => ({ useAllWoMetrics: () => ({ data: [], isLoading: false }) }));
vi.mock("@/hooks/useMaintenanceKpis", () => ({
  useMaintenanceKpis: () => ({ avgResponseMin: 0, avgMTTRMin: 0, avgMTBFMin: 0 }),
}));
vi.mock("@/hooks/useDowntime", () => ({ useDowntime: () => ({ data: [] }) }));
vi.mock("@/hooks/useLeaderScoreWeights", () => ({
  useLeaderScoreWeights: () => ({ data: { production_pct: 50, quality_pct: 30, documentation_pct: 20 } }),
}));

const TODAY = new Date();
const day = (n: number) => format(subDays(TODAY, n), "yyyy-MM-dd");

/** Uma sessão hoje, um líder, uma linha — o dia que a captura do ecrã mostrava. */
const SESSIONS = [
  {
    id: "s1", session_date: day(0), shift: "DAY", line: "Line 1", leader_name: "Ailton",
    production_items: [{ actual_qty: 2245 }],
  },
];
const RAG = [{ id: "r1", entry_date: day(0), shift: "DAY", line: "Line 1", plan_qty: 1901 }];

/**
 * As duas acções reais do Ailton, ainda por fechar, levantadas fora do período —
 * e uma terceira, dentro dele, para provar que o filtro corta pela data e não por tudo.
 */
const QUALITY_ACTIONS = [
  {
    id: "qa-old-1", leader_name: "Ailton", status: "todo", severity: "medium",
    recorded_at: `${day(46)}T11:00:00.000Z`, labels: [], validation_status: null,
    description: "Incorrect spec sheet", shift: "DAY", line: "Line 1", department: "Supervisor",
  },
  {
    id: "qa-old-2", leader_name: "Ailton", status: "in_progress", severity: "low",
    recorded_at: `${day(44)}T11:00:00.000Z`, labels: [], validation_status: null,
    description: "Extractor mounting", shift: "DAY", line: "Line 1", department: "Supervisor",
  },
  {
    id: "qa-in-range", leader_name: "Ailton", status: "in_progress", severity: "high",
    recorded_at: `${day(1)}T11:00:00.000Z`, labels: [], validation_status: null,
    description: "Magnet check", shift: "DAY", line: "Line 1", department: "Quality",
  },
];

const TABLES: Record<string, Record<string, unknown>[]> = {
  production_sessions: SESSIONS,
  rag_weekly_entries: RAG,
  quality_actions: QUALITY_ACTIONS,
  profiles: [{ id: "u1" }],
  parts_used: [],
};

/**
 * Um supabase de mentira que aplica mesmo os filtros pedidos.
 *
 * Um duplo que devolva sempre as mesmas linhas não distingue uma consulta limitada
 * pelas datas de uma que as ignora — que é exactamente o defeito em causa. Este aplica
 * `gte`/`lte`/`eq`/`in` às linhas da tabela, para que o teste falhe enquanto a consulta
 * não levar as datas.
 */
vi.mock("@/integrations/supabase/client", () => {
  function makeBuilder(table: string) {
    let rows = [...(TABLES[table] ?? [])];
    let head = false;
    const b: Record<string, unknown> = {};
    const cmp = (v: unknown) => String(v ?? "");
    Object.assign(b, {
      select: (_c?: string, opts?: { head?: boolean }) => { head = !!opts?.head; return b; },
      gte: (c: string, v: unknown) => { rows = rows.filter((r) => cmp(r[c]) >= cmp(v)); return b; },
      lte: (c: string, v: unknown) => { rows = rows.filter((r) => cmp(r[c]) <= cmp(v)); return b; },
      eq: (c: string, v: unknown) => { rows = rows.filter((r) => cmp(r[c]) === cmp(v)); return b; },
      in: (c: string, vs: unknown[]) => { rows = rows.filter((r) => vs.map(cmp).includes(cmp(r[c]))); return b; },
      order: () => b,
      limit: () => b,
      range: (from: number, to: number) => ({
        then: (res: (r: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve({ data: rows.slice(from, to + 1), error: null }).then(res, rej),
      }),
      then: (res: (r: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(head ? { count: rows.length, data: null, error: null } : { data: rows, error: null }).then(res, rej),
    });
    return b;
  }
  return {
    supabase: {
      from: (t: string) => makeBuilder(t),
      rpc: async () => ({ data: null, error: null }),
      auth: { getUser: async () => ({ data: { user: null }, error: null }), getSession: async () => ({ data: { session: null }, error: null }) },
      channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
      removeChannel: () => {},
    },
  };
});

import AnalyticsPage from "@/pages/dashboard/AnalyticsPage";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><AnalyticsPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

/** A linha da tabela de líderes, pelo nome do líder. */
async function leaderRow(name: string) {
  const cell = await screen.findByText(name);
  const row = cell.closest("tr");
  if (!row) throw new Error(`No table row for ${name}`);
  return row;
}

/** A célula "Open Actions" da linha — sexta coluna, a seguir a Doc errors. */
const OPEN_ACTIONS_COL = 5;
const openActionsCell = (row: Element) => row.querySelectorAll("td")[OPEN_ACTIONS_COL];

/** O mosaico "Open Actions" no topo do cartão, não o cabeçalho da coluna. */
function openActionsTile() {
  const label = Array.from(document.querySelectorAll("div")).find(
    (d) => d.textContent?.trim() === "Open Actions" && d.className.includes("uppercase"),
  );
  if (!label?.nextElementSibling) throw new Error("Open Actions tile not found");
  return label.nextElementSibling;
}

describe("Leader Performance — open actions and the period", () => {
  beforeEach(() => { localStorage.clear(); });

  it("counts only the open actions raised inside the selected period", async () => {
    renderPage();
    const row = await leaderRow("Ailton");
    // Três acções por fechar existem; só uma foi levantada dentro dos 30 dias, e vale
    // 3 pontos por ser high — não os 6 que as três somam. O ⚠1 é essa mesma acção
    // contada como high/critical.
    await waitFor(() => {
      expect(openActionsCell(row).textContent?.replace(/\s+/g, "")).toBe("13p⚠1");
    });
  });

  it("totals the card's Open Actions tile over the same period", async () => {
    renderPage();
    await leaderRow("Ailton");
    await waitFor(() => {
      expect(openActionsTile().textContent?.replace(/\s+/g, "")).toBe("13pts");
    });
  });
});
