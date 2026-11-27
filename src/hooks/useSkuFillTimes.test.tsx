import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useApproveSkuFillTime, useRegisterSkuFillTime } from "./useSkuFillTimes";

const { from, single, maybeSingle, select, update, insert, eq } = vi.hoisted(() => ({ from: vi.fn(), single: vi.fn(), maybeSingle: vi.fn(), select: vi.fn(), update: vi.fn(), insert: vi.fn(), eq: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));
const chain = { single, maybeSingle, select, update, insert, eq };
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>{children}</QueryClientProvider>;

beforeEach(() => {
  vi.clearAllMocks();
  from.mockReturnValue(chain); select.mockReturnValue(chain); update.mockReturnValue(chain); insert.mockReturnValue(chain); eq.mockReturnValue(chain);
});
describe("approved production standard save", () => {
  it("reads back the saved per-unit value and never adds cavities", async () => {
    single.mockResolvedValue({ data: { id: "1", approved_seconds: 0.03, time_basis: "per_unit", units_per_cycle: null }, error: null });
    const { result } = renderHook(() => useApproveSkuFillTime(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ id: "1", approved_seconds: 0.03, time_basis: "per_unit", units_per_cycle: null }); });
    expect(update).toHaveBeenCalledWith({ approved_seconds: 0.03, time_basis: "per_unit", units_per_cycle: null });
    expect(select).toHaveBeenCalledWith("id, approved_seconds, time_basis, units_per_cycle");
  });
  it("rejects a save that did not update any row", async () => {
    single.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(() => useApproveSkuFillTime(), { wrapper });
    await act(async () => { await expect(result.current.mutateAsync({ id: "1", approved_seconds: 10, time_basis: "per_unit", units_per_cycle: null })).rejects.toThrow("not saved"); });
  });
  it("registers a new SKU through the existing database insert", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    single.mockResolvedValue({ data: { id: "2", approved_seconds: 10, time_basis: "per_unit", units_per_cycle: null }, error: null });
    const p = { machine_name: "Line 2", sku_code: "CW2CL", product_description: "Whey", approved_seconds: 10, time_basis: "per_unit" as const, units_per_cycle: null };
    const { result } = renderHook(() => useRegisterSkuFillTime(), { wrapper });
    await act(async () => { await result.current.mutateAsync(p); });
    expect(insert).toHaveBeenCalledWith(p);
    expect(update).not.toHaveBeenCalled();
  });
});
