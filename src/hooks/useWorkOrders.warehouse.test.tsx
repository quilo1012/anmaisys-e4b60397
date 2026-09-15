import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Uma espera de embalagem não é trabalho de manutenção, e este hook é onde isso
 * se decide para dezanove ecrãs.
 *
 * A base já diz a regra — a policy restritiva `Warehouse orders belong to the
 * warehouse` — mas isenta o `admin`, sem o quê a matriz do armazém não
 * carregava. Resultado: na única conta de admin da fábrica as ordens de armazém
 * apareciam dentro de "Maintenance Orders" e eram contadas nos KPIs de
 * manutenção. A RLS não sabe distinguir ecrãs; este hook sabe.
 *
 * O que se fixa aqui é o lado de que ninguém se lembra: a exclusão vai no
 * SERVIDOR. Sem intervalo esta consulta trava nas 200 ordens mais recentes, e
 * uma ordem de armazém filtrada já no cliente teria gasto um dos 200 lugares na
 * mesma.
 */

const filters: { neq: [string, unknown][]; } = { neq: [] };

vi.mock("@/integrations/supabase/client", () => {
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    select: () => builder,
    order: () => builder,
    limit: () => builder,
    gte: () => builder,
    lte: () => builder,
    eq: () => builder,
    in: () => builder,
    neq: (c: string, v: unknown) => { filters.neq.push([c, v]); return builder; },
    then: (resolve: (r: unknown) => unknown) => resolve({ data: [], error: null }),
  });
  return {
    supabase: {
      from: () => builder,
      rpc: async () => ({ data: [], error: null }),
      channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
      removeChannel: () => {},
    },
  };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

describe("useWorkOrders e as ordens de armazém", () => {
  beforeEach(() => { filters.neq = []; });

  it("deixa-as no servidor quando ninguém as pede", async () => {
    const { useWorkOrders } = await import("@/hooks/useWorkOrders");
    const { result } = renderHook(() => useWorkOrders(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(filters.neq).toContainEqual(["wo_type", "warehouse_service"]);
  });

  it("traz-nas para quem as pede — o ecrã do armazém e a sua matriz", async () => {
    const { useWorkOrders } = await import("@/hooks/useWorkOrders");
    const { result } = renderHook(() => useWorkOrders({ includeWarehouse: true }), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(filters.neq).toHaveLength(0);
  });

  it("exclui-as também quando há um intervalo, que é onde os relatórios lêem", async () => {
    const { useWorkOrders } = await import("@/hooks/useWorkOrders");
    const { result } = renderHook(
      () => useWorkOrders({ from: new Date("2026-09-01"), to: new Date("2026-09-15") }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(filters.neq).toContainEqual(["wo_type", "warehouse_service"]);
  });
});
