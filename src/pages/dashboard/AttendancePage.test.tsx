/**
 * O import do TimeMoto, com o ficheiro que a fábrica exporta mesmo.
 *
 * O parser e o casamento de nomes estão testados à parte, em
 * src/lib/timeMotoSheet.test.ts. O que tem de valer aqui é o que aconteceu ao
 * utilizador: um export de uma pessoa só traz "Firstname" e nenhum apelido, dois
 * Daniéis estão na folha de pagamento, e o ecrã dizia que ninguém na folha de
 * pagamento atende por Daniel — com o botão Import morto e nada a explicar o quê
 * fazer a seguir.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import * as XLSX from "xlsx";

const EMPLOYEES = [
  { id: "e1", full_name: "Daniel Almeida", department: "Production", active: true },
  { id: "e2", full_name: "Daniel Quilo", department: "Office", active: true },
  { id: "e3", full_name: "Ana Silva", department: "Production", active: true },
];

const upsert = vi.fn(async () => ({ error: null }));

vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/AdminPinGate", () => ({
  AdminPinGate: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/BackButton", () => ({ BackButton: () => null }));
vi.mock("@/components/workforce/WorkforceTabs", () => ({ WorkforceTabs: () => null }));
vi.mock("@/components/workforce/MonthlySummary", () => ({ MonthlySummary: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useRole", () => ({ useRole: () => ({ can: () => true }) }));
vi.mock("@/hooks/useWorkforce", () => ({ useEmployees: () => ({ data: EMPLOYEES }) }));

vi.mock("@/integrations/supabase/client", () => {
  const table = (name: string) => {
    const rows = name === "employees" ? EMPLOYEES : [];
    const result = { data: rows, error: null };
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      gte: () => chain,
      lte: () => chain,
      limit: () => chain,
      maybeSingle: async () => ({ data: null, error: null }),
      upsert: (...args: unknown[]) => upsert(...(args as [])),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(res, rej),
    };
    return chain;
  };
  return { supabase: { from: (n: string) => table(n) } };
});

import AttendancePage from "@/pages/dashboard/AttendancePage";

/** O export real: uma coluna de nome, e é o nome próprio. */
const SHEET = [
  ["Firstname", "Date", "StartTime", "EndTime", "Breaks", "Duration", "WorkSchedule", "Balance", "OvertimeAdjustment", "AbsenceName", "Remarks"],
  ["Daniel", "13/07/26", "5:45", "18:15", "", "12:30", "12:00", "0:30", "0:00", "", ""],
  ["Daniel", "14/07/26", "5:30", "18:00", "", "12:30", "12:00", "0:30", "0:00", "", ""],
  ["Total", "", "", "", "", "25:00", "24:00", "1:00", "0:00", "", ""],
];

function timesheetFile() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(SHEET), "Timesheet");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const file = new File([buf], "export-2026-08-12.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  // jsdom's File has no arrayBuffer in every version, and the page reads the upload
  // through it.
  Object.defineProperty(file, "arrayBuffer", { value: async () => buf });
  return file;
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AttendancePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openPreview() {
  const { container } = renderPage();
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [timesheetFile()] } });
  await screen.findByText("Import TimeMoto timesheet");
  return container;
}

/** Radix's select opens from the keyboard, which is the part jsdom can drive. */
async function choose(person: string) {
  fireEvent.keyDown(screen.getByRole("combobox"), { key: " " });
  const option = await screen.findByRole("option", { name: person });
  fireEvent.click(option);
}

beforeEach(() => {
  localStorage.clear();
  upsert.mockClear();
  // Radix's select needs these; jsdom has neither.
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
});

describe("importing a TimeMoto sheet that names one person by their first name", () => {
  it("asks which Daniel instead of saying nobody answers to the name", async () => {
    await openPreview();

    expect(screen.getByText("Who does the sheet mean?")).toBeInTheDocument();
    expect(screen.getByText("2 people answer to this")).toBeInTheDocument();
    expect(screen.queryByText(/nobody on the payroll answers to/i)).not.toBeInTheDocument();
    expect(screen.getByText("0 of 1 people matched")).toBeInTheDocument();
  });

  it("holds the import until somebody says who it is", async () => {
    await openPreview();
    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
  });

  it("imports the days once the name is settled on a person", async () => {
    await openPreview();

    // Both Daniels are offered, and they come first.
    await choose("Daniel Quilo");

    await waitFor(() => expect(screen.getByText("1 of 1 people matched")).toBeInTheDocument());

    const importBtn = screen.getByRole("button", { name: "Import" });
    expect(importBtn).toBeEnabled();
    fireEvent.click(importBtn);

    await waitFor(() => expect(upsert).toHaveBeenCalled());
    const [rows] = upsert.mock.calls[0] as unknown as [Record<string, unknown>[]];
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.employee_id === "e2")).toBe(true);
    expect(rows[0]).toMatchObject({ on_date: "2026-07-13", worked_minutes: 750, source: "timemoto" });
  });

  it("remembers the answer for the next import, and still shows it", async () => {
    await openPreview();
    await choose("Daniel Quilo");
    await waitFor(() => expect(screen.getByRole("button", { name: "Import" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(upsert).toHaveBeenCalled());

    // Same file, a week later: the question is already answered, and visibly so —
    // the name still appears with the person it was settled on, not silently.
    cleanup();
    await openPreview();
    await waitFor(() => expect(screen.getByText("1 of 1 people matched")).toBeInTheDocument());
    expect(screen.getByText("Chosen by hand, remembered from the last import")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveTextContent("Daniel Quilo");
  });
});
