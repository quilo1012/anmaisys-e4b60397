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

function Harness({ initial = {}, onDraftChange }: {
  initial?: Partial<ScorecardEntryDraft>;
  onDraftChange?: (d: ScorecardEntryDraft) => void;
}) {
  const [draft, setDraft] = useState<ScorecardEntryDraft>({
    ...emptyDraft("leader-1", "line-1", "2026-07-05"),
    ...initial,
  });
  const setField = <K extends keyof ScorecardEntryDraft>(key: K, value: ScorecardEntryDraft[K]) => {
    setDraft((d) => {
      const next = { ...d, [key]: value };
      onDraftChange?.(next);
      return next;
    });
  };
  return <VolumePillar lineId="line-1" weekEnding="2026-07-05" draft={draft} setField={setField} />;
}

function renderHarness(initial?: Partial<ScorecardEntryDraft>, onDraftChange?: (d: ScorecardEntryDraft) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness initial={initial} onDraftChange={onDraftChange} />
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

  it("never writes anything just because the drawer was opened and the RPC resolved", async () => {
    mockRpcData = [{ planned_volume: 1000, actual_volume: 950, unplanned_downtime_minutes: 30, source_label: "RAG Weekly" }];
    const onDraftChange = vi.fn();
    renderHarness(undefined, onDraftChange);
    // Wait for the offer to actually render, proving the RPC has resolved...
    expect(await screen.findByText(/production recorded 950/i)).toBeInTheDocument();
    // ...and the field itself is still blank: opening the drawer produced no write.
    const actual = screen.getByLabelText("Actual volume") as HTMLInputElement;
    expect(actual.value).toBe("");
    expect(onDraftChange).not.toHaveBeenCalled();
  });

  it("offers production's number as text, and only fills the field once the person accepts it", async () => {
    mockRpcData = [{ planned_volume: 1000, actual_volume: 950, unplanned_downtime_minutes: 30, source_label: "RAG Weekly" }];
    renderHarness();
    const actual = screen.getByLabelText("Actual volume") as HTMLInputElement;
    const offer = await screen.findByText(/production recorded 950/i);
    expect(actual.value).toBe(""); // the offer is text, not a write

    const useThisNumber = offer.parentElement!.querySelector("button") as HTMLButtonElement;
    fireEvent.click(useThisNumber);

    await waitFor(() => expect(actual.value).toBe("950"));
    expect(await screen.findByText("From RAG Weekly")).toBeInTheDocument();
  });

  it("never overwrites a value already on the draft with production's offer", async () => {
    mockRpcData = [{ planned_volume: 1000, actual_volume: 950, unplanned_downtime_minutes: 30, source_label: "RAG Weekly" }];
    renderHarness({ actual_volume: 500 });
    expect(await screen.findByText("Changed from 950")).toBeInTheDocument();
    const actual = screen.getByLabelText("Actual volume") as HTMLInputElement;
    expect(actual.value).toBe("500");
  });

  it("marks a field manual the moment the typed number differs from the derived one", async () => {
    mockRpcData = [{ planned_volume: 1000, actual_volume: 950, unplanned_downtime_minutes: 30, source_label: "RAG Weekly" }];
    renderHarness();
    const actual = screen.getByLabelText("Actual volume") as HTMLInputElement;
    await screen.findByText(/production recorded 950/i);
    fireEvent.change(actual, { target: { value: "900" } });
    expect(await screen.findByText("Changed from 950")).toBeInTheDocument();
  });

  it("marks a field derived, not manual, when the person types the same number production offered", async () => {
    mockRpcData = [{ planned_volume: 1000, actual_volume: 950, unplanned_downtime_minutes: 30, source_label: "RAG Weekly" }];
    renderHarness();
    const actual = screen.getByLabelText("Actual volume") as HTMLInputElement;
    await screen.findByText(/production recorded 950/i);
    fireEvent.change(actual, { target: { value: "950" } });
    expect(await screen.findByText("From RAG Weekly")).toBeInTheDocument();
  });
});
