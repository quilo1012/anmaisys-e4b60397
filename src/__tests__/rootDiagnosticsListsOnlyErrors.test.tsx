import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

/**
 * Root Diagnostics lists errors; phones' daily readings live on Phone Notifications.
 *
 * 18/11/2026, 19:34: "apareceu mais erros" — more errors appeared. All (0) was on the
 * screen; beside it, "PUSH_STATE (11 devices)", nine of them people who had not yet turned
 * notifications on. A chip of readings next to a list of errors is read as errors.
 */

const errorRows: Record<string, unknown>[] = [];
const pushRows: Record<string, unknown>[] = [];

vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/hooks/usePushStateRows", () => ({
  usePushStateRows: () => ({ data: pushRows, isLoading: false, isError: false, refetch: vi.fn(), isRefetching: false }),
}));
vi.mock("@/integrations/supabase/client", () => {
  const chain = {
    select: () => chain,
    neq: () => chain,
    order: () => chain,
    limit: () => Promise.resolve({ data: errorRows, error: null }),
    in: () => Promise.resolve({ data: [{ id: "u-talita", name: "Talita Melech" }, { id: "u-eng", name: "Engineer" }, { id: "u-miguel", name: "Miguel Pereira" }], error: null }),
  };
  return { supabase: { from: () => chain } };
});

const reading = (id: string, user: string, meta: Record<string, unknown>) => ({
  id, created_at: "2026-11-18T19:00:00Z", user_id: user, user_role: "employee", error_type: "PUSH_STATE",
  message: "Push on …", stack_trace: null, route_path: "/dashboard/my-overtime",
  metadata: { platform: "ios", display: "standalone", permission: "granted", worker: "active", local: "present", server: "registered", reason: null, ...meta },
});
const TALITA = reading("p1", "u-talita", { permission: "default", local: "absent", server: "not_checked", reason: "not_enabled" });
const MIGUEL = reading("p2", "u-miguel", {});
const ENGINEER = reading("p3", "u-eng", { platform: "desktop", display: "browser", permission: "denied", server: "registered", reason: "permission_denied" });

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
}

beforeEach(() => { errorRows.length = 0; pushRows.length = 0; });

describe("Root Diagnostics", () => {
  it("shows no chip and no row for phones that are working or waiting on their owner", async () => {
    pushRows.push(TALITA, MIGUEL);
    const { default: RootDiagnosticsPage } = await import("@/pages/dashboard/RootDiagnosticsPage");
    wrap(<RootDiagnosticsPage />);
    expect(await screen.findByText(/No errors captured/)).toBeTruthy();
    expect(screen.queryByText(/PUSH_STATE/)).toBeNull();
    expect(screen.queryByText(/All \(/)).toBeNull();
  });

  it("still lists a push fault, as an error", async () => {
    pushRows.push(TALITA, ENGINEER);
    const { default: RootDiagnosticsPage } = await import("@/pages/dashboard/RootDiagnosticsPage");
    wrap(<RootDiagnosticsPage />);
    expect(await screen.findByText("Fault")).toBeTruthy();
    expect(screen.getByText("All (1)")).toBeTruthy();
    expect(screen.getByText(/still registered on the server/)).toBeTruthy();
  });

  it("points to Phone Notifications", async () => {
    const { default: RootDiagnosticsPage } = await import("@/pages/dashboard/RootDiagnosticsPage");
    wrap(<RootDiagnosticsPage />);
    expect(await screen.findByRole("button", { name: /Phone notifications/ })).toBeTruthy();
  });
});

describe("Phone Notifications", () => {
  it("lists every device by the person's name, with what they have to do", async () => {
    pushRows.push(TALITA, MIGUEL, ENGINEER);
    const { default: PhoneNotificationsPage } = await import("@/pages/dashboard/PhoneNotificationsPage");
    wrap(<PhoneNotificationsPage />);
    await waitFor(() => expect(screen.getByText("Talita Melech")).toBeTruthy());
    expect(screen.getByText("Miguel Pereira")).toBeTruthy();
    expect(screen.getByText(/1 working/)).toBeTruthy();
    expect(screen.getByText(/1 waiting on the person/)).toBeTruthy();
    expect(screen.getByText(/needs to tap Turn on/)).toBeTruthy();
  });
});
