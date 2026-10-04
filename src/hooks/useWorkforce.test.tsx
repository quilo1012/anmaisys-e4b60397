import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Uma gravacao recusada pela RLS tem de se ver.
 *
 * `employees` tem duas policies: `employees admin` (ALL, so para admin) e
 * `employees select by matrix` (SELECT, para quem tem `workforce.view`). O ecra abre o
 * formulario a quem tem `workforce.manage` — e o `production_office_admin` TEM, por
 * override na tabela `role_permission_overrides`. Cinco contas reais estao nesse caso.
 *
 * O PATCH do PostgREST sem `select()` devolve 204 e zero linhas quando a RLS nao deixa
 * passar nenhuma: `error` vem a null. O `onSuccess` disparava, o toast dizia "Saved", o
 * `invalidateQueries` relia a base e o painel voltava ao valor antigo. Era isto que
 * estava por tras de "as informacoes nao batem com o que esta no sistema": nao batem
 * porque nunca chegaram la.
 *
 * O `useCreateEmployee` ao lado ja usava `.select("id").single()` e por isso ja
 * rebentava com honestidade. So o update e que mentia.
 */
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, role: null, loading: false }) }));

/** Linhas que o PATCH devolve. Vazio = a RLS nao deixou passar nada. */
let updatedRows: Array<{ id: string }> = [{ id: "e1" }];
let calls: Array<{ table: string; op: string; payload: unknown }> = [];

vi.mock("@/integrations/supabase/client", () => {
  function makeBuilder(table: string) {
    let op = "read";
    let payload: unknown = null;
    let selectedAfterWrite = false;
    const record = () => calls.push({ table, op, payload });
    const builder: Record<string, unknown> = {};
    Object.assign(builder, {
      select: () => { if (op !== "read") selectedAfterWrite = true; return builder; },
      eq: () => builder,
      update: (p: unknown) => { op = "update"; payload = p; return builder; },
      upsert: (p: unknown) => { op = "upsert"; payload = p; return builder; },
      single: async () => {
        record();
        return { data: { shift_group: "Day", shift_pattern_id: "mon-thu" }, error: null };
      },
      then: (resolve: (r: unknown) => unknown) => {
        record();
        const data = op === "update" && selectedAfterWrite ? updatedRows : [];
        return resolve({ data, error: null });
      },
    });
    return builder;
  }
  return { supabase: { from: (t: string) => makeBuilder(t) } };
});

import { useUpdateEmployee } from "./useWorkforce";

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  calls = [];
  updatedRows = [{ id: "e1" }];
});

describe("useUpdateEmployee", () => {
  it("falha quando a RLS nao deixou passar linha nenhuma", async () => {
    updatedRows = [];
    const { result } = renderHook(() => useUpdateEmployee(), { wrapper: wrapper() });
    result.current.mutate({ id: "e1", patch: { full_name: "Abner Silva" } });

    await waitFor(() => expect(result.current.isError).toBe(true));
    // E diz porque, para quem ve o toast nao ficar a pensar que foi a rede.
    expect(String(result.current.error)).toMatch(/permission|admin/i);
  });

  it("nao da por falhada uma gravacao que passou", async () => {
    const { result } = renderHook(() => useUpdateEmployee(), { wrapper: wrapper() });
    result.current.mutate({ id: "e1", patch: { full_name: "Abner Silva" } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("escreve o nome como qualquer outro campo", async () => {
    const { result } = renderHook(() => useUpdateEmployee(), { wrapper: wrapper() });
    result.current.mutate({ id: "e1", patch: { full_name: "Felipe Araujo", email: "f@x.uk" } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const write = calls.find((c) => c.table === "employees" && c.op === "update");
    expect(write?.payload).toMatchObject({ full_name: "Felipe Araujo", email: "f@x.uk" });
  });
});
