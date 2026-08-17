/**
 * The drawer's failure/blank/loaded states, rendered.
 *
 * `v_leader_weekly_scorecard` does not exist in the database yet, so today every
 * open of this drawer errors — that must show as an explicit failure, never as a
 * quietly blank verdict. A row with no week yet (query succeeds, no row found) is
 * a different fact from a failed query, and this drawer must keep the two apart.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ScorecardBoardRow } from "@/lib/scorecardWeek";

let mockVerdictRow: Record<string, unknown> | null = null;
let mockVerdictError: Error | null = null;

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

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
      from: vi.fn(() => ({ select: vi.fn(() => selectBuilder()) })),
      // scorecard_derived_volume does not exist in the database yet — every call
      // errors, same as the real thing today. VolumePillar must handle that
      // without breaking the drawer's other assertions.
      rpc: vi.fn(async () => ({ data: null, error: new Error('function "scorecard_derived_volume" does not exist') })),
    },
  };
});

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
