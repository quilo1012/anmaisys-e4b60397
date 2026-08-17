/**
 * VolumePillar reads what `scorecard_derived_volume` returns and never fabricates
 * a number. `setField` here is a real state updater (not a mock) so these tests
 * assert what actually ends up in the draft, not that a function was called.
 */
import React, { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { emptyDraft, type ScorecardEntryDraft } from "@/lib/scorecardEntry";

let mockRpcData: Record<string, unknown>[] | null = null;
let mockRpcError: Error | null = null;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(async () => ({ data: mockRpcData, error: mockRpcError })),
  },
}));

import { VolumePillar } from "./VolumePillar";

function Harness({ initial = {} }: { initial?: Partial<ScorecardEntryDraft> }) {
  const [draft, setDraft] = useState<ScorecardEntryDraft>({
    ...emptyDraft("leader-1", "line-1", "2026-07-05"),
    ...initial,
  });
  const setField = <K extends keyof ScorecardEntryDraft>(key: K, value: ScorecardEntryDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };
  return <VolumePillar lineId="line-1" weekEnding="2026-07-05" draft={draft} setField={setField} />;
}

function renderHarness(initial?: Partial<ScorecardEntryDraft>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness initial={initial} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockRpcData = null;
  mockRpcError = null;
});

describe("VolumePillar", () => {
  it("stays empty rather than showing 0 when nothing has been typed and nothing was derived", async () => {
    mockRpcData = null; // the query resolves, there is simply no row for this line/week
    renderHarness();
    await waitFor(() => expect(screen.getByText(/nothing recorded/i)).toBeInTheDocument());
    const actual = screen.getByLabelText("Actual volume") as HTMLInputElement;
    expect(actual.value).toBe("");
  });

  it("tells a failed lookup apart from production having nothing", async () => {
    mockRpcError = new Error('function "scorecard_derived_volume" does not exist');
    renderHarness();
    expect(await screen.findByText(/could not check what production recorded/i)).toBeInTheDocument();
    expect(screen.queryByText(/nothing recorded/i)).not.toBeInTheDocument();
    // Still fully usable by hand — never a fabricated number.
    const actual = screen.getByLabelText("Actual volume") as HTMLInputElement;
    expect(actual.value).toBe("");
  });

  it("offers production's number into a blank field, and marks it derived", async () => {
    mockRpcData = [{ planned_volume: 1000, actual_volume: 950, unplanned_downtime_minutes: 30, source_label: "RAG Weekly" }];
    renderHarness();
    const actual = screen.getByLabelText("Actual volume") as HTMLInputElement;
    await waitFor(() => expect(actual.value).toBe("950"));
    // All three numeric fields matched their derived values, so the note appears
    // next to each of them.
    expect((await screen.findAllByText("From RAG Weekly")).length).toBe(3);
  });

  it("never overwrites a value already on the draft", async () => {
    mockRpcData = [{ planned_volume: 1000, actual_volume: 950, unplanned_downtime_minutes: 30, source_label: "RAG Weekly" }];
    renderHarness({ actual_volume: 500 });
    await waitFor(() => expect(screen.queryByText(/nothing recorded/i)).not.toBeInTheDocument());
    const actual = screen.getByLabelText("Actual volume") as HTMLInputElement;
    expect(actual.value).toBe("500");
  });

  it("marks a field manual the moment the typed number differs from the derived one", async () => {
    mockRpcData = [{ planned_volume: 1000, actual_volume: 950, unplanned_downtime_minutes: 30, source_label: "RAG Weekly" }];
    renderHarness();
    const actual = screen.getByLabelText("Actual volume") as HTMLInputElement;
    await waitFor(() => expect(actual.value).toBe("950"));
    fireEvent.change(actual, { target: { value: "900" } });
    expect(await screen.findByText("Changed from 950")).toBeInTheDocument();
  });
});
