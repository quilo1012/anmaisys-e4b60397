import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => {
    const result = { data: table === "line_leaders" ? [{ name: "Muriel", shift: "Day" }] : [], error: null };
    const builder = {
      select: () => builder, eq: () => builder, gte: () => builder,
      not: () => builder, order: () => builder, range: () => builder,
      then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
    };
    return builder;
  } },
}));

import { useLeaderShifts } from "./useLeaderShifts";

afterEach(cleanup);

describe("active leader cache isolation", () => {
  it("does not consume or overwrite Quality Actions' id/name rows", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const qualityLeaders = [{ id: "leader-1", name: "Muriel" }];
    client.setQueryData(["line_leaders_active"], qualityLeaders);
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useLeaderShifts(), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.leaders).toEqual([{ name: "Muriel", shift: "Day" }]);
    expect(client.getQueryData(["line_leaders_active"])).toEqual(qualityLeaders);
    client.clear();
  });

  it("keeps shift rows separate when Quality Actions populates its list later", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useLeaderShifts(), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));
    client.setQueryData(["line_leaders_active"], [{ id: "leader-1", name: "Muriel" }]);
    await waitFor(() => expect(result.current.leaders).toEqual([{ name: "Muriel", shift: "Day" }]));
    client.clear();
  });
});