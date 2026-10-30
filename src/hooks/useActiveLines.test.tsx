import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * A linha "Gel Machine" foi o Gel Packing com outro nome. Os dados passaram para
 * "Gel Packing" e a linha ficou inactiva — não apagada, porque há ordens de manutenção
 * que a nomeiam. O filtro do Performance e o do Production Control liam `lines` sem
 * olhar para `active`, e continuavam a oferecer "Gel Machine" como linha.
 */

const ROWS = [
  { id: "a", name: "Gel Packing", active: true },
  { id: "b", name: "Gel Machine", active: false },
  { id: "c", name: "Line 1", active: true },
];

vi.mock("@/integrations/supabase/client", () => {
  function makeBuilder() {
    const eqs: Record<string, unknown> = {};
    const builder: any = {
      select: vi.fn(() => builder),
      order: vi.fn(() => builder),
      eq: vi.fn((col: string, val: unknown) => {
        eqs[col] = val;
        return builder;
      }),
      then: (resolve: any) =>
        resolve({
          data: ROWS.filter((r) => !("active" in eqs) || r.active === eqs.active).map(({ id, name }) => ({ id, name })),
          error: null,
        }),
    };
    return builder;
  }
  return { supabase: { from: vi.fn(() => makeBuilder()) } };
});

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { useActiveLines } from "./useProductionPlanner";

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe("useActiveLines", () => {
  it("não oferece uma linha desactivada", async () => {
    const { result } = renderHook(() => useActiveLines(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((l) => l.name)).toEqual(["Gel Packing", "Line 1"]);
  });
});
