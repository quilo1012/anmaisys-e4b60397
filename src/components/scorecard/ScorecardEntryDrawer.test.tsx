/**
 * The drawer's failure/blank/loaded states, rendered.
 *
 * `v_leader_weekly_scorecard` does not exist in the database yet, so today every
 * open of this drawer errors — that must show as an explicit failure, never as a
 * quietly blank verdict. A row with no week yet (query succeeds, no row found) is
 * a different fact from a failed query, and this drawer must keep the two apart.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ScorecardBoardRow } from "@/lib/scorecardWeek";

let mockVerdictRow: Record<string, unknown> | null = null;
let mockVerdictError: Error | null = null;
const upsertCalls: Record<string, unknown>[] = [];
let upsertError: { message: string } | null = null;
let mockAuthUserId: string | null = "auth-user-1";
// Controls which scorecard actions the signed-in role is granted, per test.
// Defaults to false for both — most of the pre-existing tests below never
// click a button, so this only matters for the submit/approve tests added
// for Task 12.
let mockCanFill = false;
let mockCanApprove = false;

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("@/hooks/useRole", () => ({
  useRole: () => ({
    can: (action: string) =>
      (action === "scorecard.fill" && mockCanFill) ||
      (action === "scorecard.approve" && mockCanApprove),
  }),
}));

vi.mock("@/integrations/supabase/client", () => {
  function selectBuilder() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock builder
    const builder: any = {
      eq: vi.fn(() => builder),
      maybeSingle: vi.fn(async () => {
        if (mockVerdictError) return { data: null, error: mockVerdictError };
        return { data: mockVerdictRow, error: null };
      }),
    };
    return builder;
  }
  return {
    supabase: {
      from: vi.fn((table: string) => {
        if (table === "leader_weekly_scorecard") {
          return {
            upsert: vi.fn(async (row: Record<string, unknown>) => {
              upsertCalls.push(row);
              return { error: upsertError };
            }),
          };
        }
        return { select: vi.fn(() => selectBuilder()) };
      }),
      // scorecard_derived_volume does not exist in the database yet — every call
      // errors, same as the real thing today. VolumePillar must handle that
      // without breaking the drawer's other assertions.
      rpc: vi.fn(async () => ({ data: null, error: new Error('function "scorecard_derived_volume" does not exist') })),
      auth: {
        getUser: vi.fn(async () => ({ data: { user: mockAuthUserId ? { id: mockAuthUserId } : null } })),
      },
    },
  };
});

import { toast } from "sonner";
import { ScorecardEntryDrawer } from "./ScorecardEntryDrawer";

const row: ScorecardBoardRow = {
  leader_id: "leader-1",
  leader_name: "JOAO SILVA",
  line_id: "line-1",
  line_name: "Line 3",
  entry_id: null,
  state: "por preencher",
  volume_rag: null,
  quality_rag: null,
  hs_rag: null,
  overall_rag: null,
  rag_driver: null,
  capa_required: null,
  score_final: null,
  score_bruto: null,
  cap_reason: null,
  cap_applied: null,
};

function renderDrawer(props: Partial<React.ComponentProps<typeof ScorecardEntryDrawer>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ScorecardEntryDrawer row={row} weekEnding="2026-07-05" onClose={() => {}} {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockVerdictRow = null;
  mockVerdictError = null;
  upsertCalls.length = 0;
  upsertError = null;
  mockAuthUserId = "auth-user-1";
  mockCanFill = false;
  mockCanApprove = false;
  vi.mocked(toast.error).mockClear();
});

describe("ScorecardEntryDrawer", () => {
  it("shows the leader, line and week in the header", async () => {
    renderDrawer();
    expect(await screen.findByText("JOAO SILVA")).toBeInTheDocument();
    expect(screen.getByText(/Line 3.*2026-07-05/)).toBeInTheDocument();
  });

  it("tells the user the query failed, rather than showing a blank verdict", async () => {
    mockVerdictError = new Error('relation "v_leader_weekly_scorecard" does not exist');
    renderDrawer();
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load this week/i);
    expect(screen.getByText(/does not exist/i)).toBeInTheDocument();
    // The "Result" verdict chip must not appear alongside a failure.
    expect(screen.queryByText("Result")).not.toBeInTheDocument();
  });

  it("shows an absent (not Green) RAG chip for a genuinely blank week", async () => {
    mockVerdictRow = null; // query succeeds, no row for this leader/line/week yet
    renderDrawer();
    expect(await screen.findByText("Result")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // RagChip renders "—" for a null value, never a coloured Green chip.
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders the database's overall_rag and rag_driver, not a recomputed one", async () => {
    mockVerdictRow = {
      leader_id: "leader-1",
      line_id: "line-1",
      week_ending: "2026-07-05",
      overall_rag: "Red",
      rag_driver: "Quality Fail this week",
    };
    renderDrawer();
    expect(await screen.findByText("Red")).toBeInTheDocument();
    expect(screen.getByText("Quality Fail this week")).toBeInTheDocument();
  });

  it("renders nothing when no row is open", () => {
    const { container } = renderDrawer({ row: null });
    expect(container.querySelector('[role="dialog"]')).not.toBeInTheDocument();
  });
});

describe("ScorecardEntryDrawer — CAPA gate and approval", () => {
  it("blocks Approve and names every missing field when the week is a Fail with an empty CAPA", async () => {
    mockCanApprove = true;
    mockVerdictRow = {
      leader_id: "leader-1",
      line_id: "line-1",
      week_ending: "2026-07-05",
      overall_rag: "Red",
      quality_fail_type: "Fail",
    };
    renderDrawer();

    const approveButton = await screen.findByRole("button", { name: "Approve" });
    expect(approveButton).toBeDisabled();
    expect(screen.getByText(/cannot approve yet/i)).toHaveTextContent(
      "Cannot approve yet — missing: Root cause, Corrective action, CAPA owner, CAPA due date.",
    );
  });

  it("does not ask a Not Done for a CAPA — it is a discipline failure, not a product deviation", async () => {
    mockCanApprove = true;
    mockVerdictRow = {
      leader_id: "leader-1",
      line_id: "line-1",
      week_ending: "2026-07-05",
      overall_rag: "Red",
      quality_fail_type: "Not Done",
    };
    renderDrawer();

    const approveButton = await screen.findByRole("button", { name: "Approve" });
    expect(approveButton).not.toBeDisabled();
    expect(screen.queryByText(/cannot approve yet/i)).not.toBeInTheDocument();
    // CapaBlock itself must not render for a Not Done.
    expect(screen.queryByLabelText("Root cause")).not.toBeInTheDocument();
  });

  it("Approve is not offered to a role without scorecard.approve, even if it could see the week", async () => {
    mockCanApprove = false;
    mockCanFill = true;
    mockVerdictRow = { leader_id: "leader-1", line_id: "line-1", week_ending: "2026-07-05", quality_fail_type: null };
    renderDrawer();

    await screen.findByRole("button", { name: "Submit" });
    expect(screen.queryByRole("button", { name: /approve/i })).not.toBeInTheDocument();
  });

  it("Submit stamps submitted_by and submitted_at", async () => {
    mockCanFill = true;
    mockVerdictRow = { leader_id: "leader-1", line_id: "line-1", week_ending: "2026-07-05", quality_fail_type: null };
    renderDrawer();

    const submitButton = await screen.findByRole("button", { name: "Submit" });
    fireEvent.click(submitButton);

    await waitFor(() => expect(upsertCalls.length).toBe(1));
    expect(upsertCalls[0].submitted_by).toBe("auth-user-1");
    expect(upsertCalls[0].submitted_at).toEqual(expect.any(String));
  });

  it("Approve stamps approved_by and approved_at once the CAPA is clear", async () => {
    mockCanApprove = true;
    mockVerdictRow = {
      leader_id: "leader-1",
      line_id: "line-1",
      week_ending: "2026-07-05",
      quality_fail_type: "Fail",
      root_cause: "x",
      corrective_action: "y",
      capa_owner: "z",
      capa_due_date: "2026-07-31",
    };
    renderDrawer();

    const approveButton = await screen.findByRole("button", { name: "Approve" });
    expect(approveButton).not.toBeDisabled();
    fireEvent.click(approveButton);

    await waitFor(() => expect(upsertCalls.length).toBe(1));
    expect(upsertCalls[0].approved_by).toBe("auth-user-1");
    expect(upsertCalls[0].approved_at).toEqual(expect.any(String));
  });

  it("a rejected Submit surfaces the database's refusal and does NOT present itself as submitted", async () => {
    mockCanFill = true;
    upsertError = { message: 'Semana com check reprovado (Fail) nao pode ser aprovada sem CAPA' };
    mockVerdictRow = { leader_id: "leader-1", line_id: "line-1", week_ending: "2026-07-05", quality_fail_type: null };
    renderDrawer();

    const submitButton = await screen.findByRole("button", { name: "Submit" });
    fireEvent.click(submitButton);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Semana com check reprovado (Fail) nao pode ser aprovada sem CAPA',
    ));
    // The write was rejected — the query's confirmed data never changed — so
    // the button must still read "Submit" and stay clickable, not flip to a
    // disabled "Submitted" as if the write had landed.
    expect(screen.getByRole("button", { name: "Submit" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submitted" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit" })).not.toBeDisabled();
  });

  it("a rejected Approve surfaces the database's refusal and does NOT present itself as approved", async () => {
    mockCanApprove = true;
    upsertError = { message: 'Aprovacao exige approved_by.' };
    mockVerdictRow = { leader_id: "leader-1", line_id: "line-1", week_ending: "2026-07-05", quality_fail_type: null };
    renderDrawer();

    const approveButton = await screen.findByRole("button", { name: "Approve" });
    expect(approveButton).not.toBeDisabled();
    fireEvent.click(approveButton);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Aprovacao exige approved_by.'));
    // Same guarantee for Approve: a rejected write leaves the confirmed record
    // (and therefore the button) exactly as it was before the click.
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approved" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).not.toBeDisabled();
  });
});
