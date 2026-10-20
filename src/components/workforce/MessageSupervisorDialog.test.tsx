/**
 * The employee's side of the thread with the supervisor. The reply has to be findable
 * (a count on the button), read when opened, and each message says when it was sent
 * and — on your own — whether it has been seen.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MessageSupervisorDialog } from "./MessageSupervisorDialog";
import { dmInboxPath } from "@/hooks/useDirectMessages";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => state.rpc(...a) } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const state = vi.hoisted(() => ({ unread: {} as Record<string, number>, markRead: vi.fn(), thread: [] as unknown[], partner: null as string | null, supervisor: null as null | { user_id: string; full_name: string }, rpc: vi.fn() }));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "me" }, role: "employee" }) }));
vi.mock("@/hooks/useDirectMessages", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useDirectMessages")>()),
  useDMThread: (partner: string | null) => { if (partner) state.partner = partner; return { data: partner ? state.thread : [], isLoading: false }; },
  useMySupervisor: () => ({ data: { notSetUp: false, supervisor: state.supervisor } }),
  useDMUnreadBySender: () => ({ data: state.unread }),
  useMarkDMRead: () => ({ mutate: state.markRead }),
}));

const request = { id: "r1", on_date: "2026-10-20", starts_at: "06:00", ends_at: "14:00", created_by: "sup" };
const renderIt = () => render(
  <QueryClientProvider client={new QueryClient()}>
    <MessageSupervisorDialog request={request} fmtDate={(d) => d} />
  </QueryClientProvider>,
);

beforeEach(() => {
  state.unread = {}; state.markRead.mockReset();
  state.partner = null; state.supervisor = null;
  state.rpc = vi.fn(async () => ({ data: "m9", error: null }));
  state.thread = [
    { id: "m1", sender_id: "me", sender_name: "Ana", recipient_id: "sup", message: "I'll be late", read_at: "2026-10-19T08:01:00Z", created_at: "2026-10-19T08:00:00Z", image_url: null, audio_url: null },
    { id: "m2", sender_id: "sup", sender_name: "Rui", recipient_id: "me", message: "Fine", read_at: null, created_at: "2026-10-19T08:05:00Z", image_url: null, audio_url: null },
  ];
});

describe("MessageSupervisorDialog", () => {
  it("shows unread replies on the button and reads them when opened", () => {
    state.unread = { sup: 2 };
    renderIt();
    expect(screen.getByLabelText("2 unread replies")).toBeInTheDocument();
    expect(state.markRead).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /message supervisor/i }));
    expect(state.markRead).toHaveBeenCalled();
  });

  it("does not mark anything read when nothing is unread", () => {
    renderIt();
    expect(screen.queryByLabelText(/unread/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /message supervisor/i }));
    expect(state.markRead).not.toHaveBeenCalled();
  });

  it("dates every message and says when yours was seen", () => {
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: /message supervisor/i }));
    expect(screen.getAllByRole("time")).toHaveLength(2);
    expect(screen.getByLabelText("Seen")).toBeInTheDocument();
  });
});

describe("dmInboxPath", () => {
  it("sends an employee to My Overtime, where their thread is, and everyone else to Messages", () => {
    expect(dmInboxPath("employee")).toBe("/dashboard/my-overtime?chat=supervisor");
    expect(dmInboxPath("manager")).toBe("/dashboard/communication");
  });
});

describe("MessageSupervisorDialog — the supervisor on file", () => {
  it("talks to the supervisor on file, not the poster, and names them", () => {
    state.supervisor = { user_id: "boss", full_name: "Rui Lopes" };
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: /message supervisor/i }));
    expect(state.partner).toBe("boss");
    expect(screen.getByText("Message Rui Lopes")).toBeInTheDocument();
  });

  it("without an ask it writes through message_my_supervisor, opened from the link", async () => {
    state.supervisor = { user_id: "boss", full_name: "Rui Lopes" };
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MessageSupervisorDialog defaultOpen label="Message Rui Lopes" />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Late today" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() =>
      expect(state.rpc).toHaveBeenCalledWith("message_my_supervisor", { p_message: "Late today" }));
  });

  it("with nobody on file and no ask, it says so and cannot send", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MessageSupervisorDialog defaultOpen />
      </QueryClientProvider>,
    );
    expect(screen.getByText(/No supervisor is on file/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
  });
});
