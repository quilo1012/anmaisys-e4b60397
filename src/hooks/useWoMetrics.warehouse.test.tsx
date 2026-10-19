import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Admin's maintenance times without the warehouse.
 *
 * `v_wo_metrics` has no `wo_type` and the warehouse policy exempts admin, so admin
 * alone got warehouse orders in MTTR and response times. The hook drops them by id.
 */
vi.mock("@/integrations/supabase/client", () => {
  function builder(table: string) {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b, eq: () => b, gte: () => b, lte: () => b, order: () => b,
      range: async () => ({
        data: table === "v_wo_metrics" ? [{ id: "m1" }, { id: "w1" }] : [{ id: "w1" }],
        error: null,
      }),
    });
    return b;
  }
  return { supabase: { from: (t: string) => builder(t) } };
});

import { useAllWoMetrics } from "./useWoMetrics";

describe("useAllWoMetrics", () => {
  it("leaves warehouse orders out, whoever is reading", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useAllWoMetrics(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((r) => r.id)).toEqual(["m1"]);
  });
});
