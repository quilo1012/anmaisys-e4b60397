/**
 * The list the badge prompt promises: a supervisor picks which person a login is.
 * Pinned here: nothing is linked without a press, the database's refusal is what the
 * supervisor reads, an unlink needs a second press, and "not set up" never reads as
 * "everybody is linked".
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const t = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: t }));
vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
const h = vi.hoisted(() => ({ links: vi.fn(), link: vi.fn(), unlink: vi.fn() }));
vi.mock("@/hooks/useLoginLinks", () => ({
  useLoginLinks: h.links,
  useLoginLinkMutations: () => ({
    link: { mutate: h.link, isPending: false },
    unlink: { mutate: h.unlink, isPending: false },
  }),
}));

import LinkAccountsPage from "@/pages/dashboard/LinkAccountsPage";

const READY = {
  state: "ready",
  logins: [{
    user_id: "u-daniel", email: "daniel@example.invalid", name: "Daniel Quilo", roles: ["employee"],
    created_at: "2026-10-12T10:00:00Z", suggested_employee_id: "e-21",
  }],
  employees: [
    { id: "e-21", full_name: "Daniel Quilo", employee_ref: "E021", department: "Office", shift_group: null },
    { id: "e-99", full_name: "Daniel Almeida", employee_ref: "E099", department: "Production", shift_group: "Day" },
  ],
  linked: [{ employee_id: "e-45", full_name: "Ana Silva", employee_ref: "E045", department: "Production", user_id: "u-ana", email: "ana@example.invalid" }],
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><LinkAccountsPage /></MemoryRouter></QueryClientProvider>);
}

describe("Link accounts", () => {
  beforeEach(() => {
    h.links.mockReset(); h.link.mockReset(); h.unlink.mockReset(); t.error.mockReset();
  });

  it("says it is being set up rather than showing an empty list", () => {
    h.links.mockReturnValue({ data: { state: "notSetUp" }, isPending: false, isError: false });
    renderPage();
    expect(screen.getByText(/being set up/i)).toBeInTheDocument();
    expect(screen.queryByText(/Every login is linked/i)).not.toBeInTheDocument();
  });

  it("offers the suggestion, but links only when somebody presses Link — and by id", () => {
    h.links.mockReturnValue({ data: READY, isPending: false, isError: false });
    renderPage();
    expect(screen.getByText(/Suggested: Daniel Quilo · E021/)).toBeInTheDocument();
    expect(h.link).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    expect(h.link.mock.calls[0][0]).toEqual({ userId: "u-daniel", employeeId: "e-21" });
  });

  it("shows the database's own refusal", () => {
    h.links.mockReturnValue({ data: READY, isPending: false, isError: false });
    h.link.mockImplementation((_v, opts) => opts.onError(new Error("That person is already linked to a login, or is no longer active.")));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    expect(t.error).toHaveBeenCalledWith("That person is already linked to a login, or is no longer active.");
  });

  it("asks twice before unlinking", () => {
    h.links.mockReturnValue({ data: READY, isPending: false, isError: false });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Unlink" }));
    expect(h.unlink).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm unlink" }));
    expect(h.unlink.mock.calls[0][0]).toBe("e-45");
  });

  it("filters both lists by name, email or badge", () => {
    h.links.mockReturnValue({ data: READY, isPending: false, isError: false });
    renderPage();
    fireEvent.change(screen.getByLabelText("Filter"), { target: { value: "E045" } });
    expect(screen.queryAllByTestId("unlinked-login")).toHaveLength(0);
    expect(screen.getAllByTestId("linked-row")).toHaveLength(1);
  });
});
