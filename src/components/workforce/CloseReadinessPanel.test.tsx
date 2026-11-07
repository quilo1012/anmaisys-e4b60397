import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { buildClose, type ClosePersonInput } from "@/lib/financeClose";
import type { PayslipRaw } from "@/components/workforce/payslipDraftData";

const env = vi.hoisted(() => ({ reach: "2026-11-02" as string | null, raw: null as unknown, filters: [] as string[] }));

vi.mock("@/integrations/supabase/client", () => {
  const chain = {
    select: () => chain,
    // Only days somebody worked count as the clock's reach (07/11: future rows with 0 worked).
    gt: (col: string, v: number) => { env.filters.push(`${col}>${v}`); return chain; },
    order: () => chain,
    limit: async () => ({ data: env.reach ? [{ on_date: env.reach }] : [], error: null }),
  };
  return { supabase: { from: () => chain, rpc: async () => ({ data: null, error: null }) } };
});
vi.mock("@/components/workforce/payslipDraftData", async (orig) => ({
  ...(await orig<typeof import("@/components/workforce/payslipDraftData")>()),
  fetchPayslipRaw: async () => env.raw,
}));

import { CloseReadinessPanel } from "@/components/workforce/CloseReadinessPanel";

const PERIOD = { id: "p", name: "October 2026", start_date: "2026-10-12", end_date: "2026-11-08" };
const PATTERN = { name: "Fri–Mon days", days: [1, 5, 6, 7], starts_at: "06:00:00", ends_at: "18:00:00", break_minutes: 0 };
const person: ClosePersonInput = {
  employeeId: "a", name: "Person A", employeeRef: null, lineId: null, department: "Production", shift: "Day",
  openingBalanceMin: null, clockedBalanceMin: -1, payrollOtHours: null, absences: {}, daysPresent: 0, partDayHours: 0,
  patternName: PATTERN.name, patternDays: PATTERN.days, shiftsWorked: 0, shiftsHoliday: 0, plannedDates: null,
};
const RAW: PayslipRaw = {
  patterns: [{ employee_id: "a", pattern: PATTERN }],
  clocks: [
    { employee_id: "a", on_date: "2026-10-23", start_time: null, end_time: null, worked_minutes: 0, balance_minutes: -720, scheduled_minutes: 720, overtime_adj_minutes: 0, absence_name: null },
    { employee_id: "a", on_date: "2026-10-27", start_time: "6:01", end_time: "18:00", worked_minutes: 719, balance_minutes: 719, scheduled_minutes: 0, overtime_adj_minutes: 0, absence_name: null },
  ],
  marks: [],
  board: [{ employee_id: "a", on_date: "2026-11-03", shift: "Day", status: "overtime", half_day: false, left_early_at: null, arrived_late_at: null, overtime_request_id: "q2" }],
  overtime: [{ employee_id: "a", request_id: "q2", on_date: "2026-11-03", starts_at: "06:00:00", ends_at: "18:00:00", outcome: null }],
};

function renderPanel(onPick = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CloseReadinessPanel rows={buildClose([person], PERIOD.start_date, PERIOD.end_date)} period={PERIOD} to="2026-11-07" today="2026-11-07" onPick={onPick} />
    </QueryClientProvider>,
  );
  return onPick;
}

describe("Before you close", () => {
  it("says the period is not ready, and why, with the people named", async () => {
    env.reach = "2026-11-02"; env.raw = RAW;
    const onPick = renderPanel();
    expect(await screen.findByText(/Not ready/)).toBeInTheDocument();
    expect(screen.getByTestId("readiness-clock")).toHaveTextContent("Clock records reach 02/11: 5 days of the period have no hours yet");
    expect(await screen.findByText("1 person has 12 h of overtime the clock does not have yet")).toBeInTheDocument();
    expect(screen.getByTestId("readiness-absentNoLeave")).toHaveTextContent(/Person A\s*23\/10/);
    fireEvent.click(screen.getAllByRole("button", { name: /Person A/ })[0]);
    expect(onPick).toHaveBeenCalledWith("Person A");
    expect(env.filters).toContain("worked_minutes>0");
  });
});
