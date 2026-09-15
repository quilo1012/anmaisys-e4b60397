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
/** Answers keyed by `_leader_id` — for the tests that assert WHO is being asked about. */
let mockRpcByLeader: Record<string, Record<string, unknown>[] | null> | null = null;
const rpcCalls: { name: string; params: Record<string, unknown> }[] = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(async (name: string, params: Record<string, unknown>) => {
      rpcCalls.push({ name, params });
      if (mockRpcByLeader) {
        return { data: mockRpcByLeader[String(params?._leader_id)] ?? null, error: null };
      }
      return { data: mockRpcData, error: mockRpcError };
    }),
  },
}));

import { VolumePillar } from "./VolumePillar";

function Harness({ initial = {}, onDraftChange, leaderId = "leader-1" }: {
  initial?: Partial<ScorecardEntryDraft>;
  onDraftChange?: (d: ScorecardEntryDraft) => void;
  leaderId?: string;
}) {
  const [draft, setDraft] = useState<ScorecardEntryDraft>({
    ...emptyDraft(leaderId, "line-1", "2026-07-05"),
    ...initial,
  });
  const setField = <K extends keyof ScorecardEntryDraft>(key: K, value: ScorecardEntryDraft[K]) => {
    setDraft((d) => {
      const next = { ...d, [key]: value };
      onDraftChange?.(next);
      return next;
    });
  };
  return <VolumePillar lineId="line-1" leaderId={leaderId} weekEnding="2026-07-05" draft={draft} setField={setField} />;
}

function renderHarness(
  initial?: Partial<ScorecardEntryDraft>,
  onDraftChange?: (d: ScorecardEntryDraft) => void,
  leaderId?: string,
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness initial={initial} onDraftChange={onDraftChange} leaderId={leaderId} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockRpcData = null;
  mockRpcError = null;
  mockRpcByLeader = null;
  rpcCalls.length = 0;
  // Radix's select needs these; jsdom has neither.
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
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

  it("marks a hand-typed volume manual even when production offered nothing at all", async () => {
    // The case volume_source was written for: no row from the RPC, so the number
    // in the box came from a person and nowhere else. The old guard
    // (`if (field === "actual_volume" && derived)`) left the column null here.
    mockRpcData = null;
    const onDraftChange = vi.fn();
    renderHarness(undefined, onDraftChange);
    await waitFor(() => expect(screen.getByText(/nothing recorded/i)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Actual volume"), { target: { value: "1000" } });

    await waitFor(() => expect(onDraftChange).toHaveBeenCalled());
    const last = onDraftChange.mock.calls[onDraftChange.mock.calls.length - 1][0] as ScorecardEntryDraft;
    expect(last.volume_source).toBe("manual");
  });

  it("marks a hand-typed volume manual when the lookup itself failed", async () => {
    mockRpcError = new Error('function "scorecard_derived_volume" does not exist');
    const onDraftChange = vi.fn();
    renderHarness(undefined, onDraftChange);
    expect(await screen.findByText(/could not check what production recorded/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Actual volume"), { target: { value: "1000" } });

    await waitFor(() => expect(onDraftChange).toHaveBeenCalled());
    const last = onDraftChange.mock.calls[onDraftChange.mock.calls.length - 1][0] as ScorecardEntryDraft;
    expect(last.volume_source).toBe("manual");
  });

  it("clearing the volume clears its source too, rather than leaving a stale stamp", async () => {
    mockRpcData = null;
    const onDraftChange = vi.fn();
    renderHarness({ actual_volume: 1000, volume_source: "manual" }, onDraftChange);
    await waitFor(() => expect(screen.getByText(/nothing recorded/i)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Actual volume"), { target: { value: "" } });

    await waitFor(() => expect(onDraftChange).toHaveBeenCalled());
    const last = onDraftChange.mock.calls[onDraftChange.mock.calls.length - 1][0] as ScorecardEntryDraft;
    expect(last.volume_source).toBeNull();
  });

  it("offers the downtime reasons in English, never the database's raw Portuguese enum", async () => {
    renderHarness();
    fireEvent.keyDown(screen.getByRole("combobox"), { key: " " });

    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "Breakdown", "No raw material", "Mix changeover", "Short staffed", "Other", "Not applicable",
    ]);
    for (const raw of ["Quebra", "Falta de Materia Prima", "Troca de Mix", "Falta de Pessoal"]) {
      expect(screen.queryByText(raw)).not.toBeInTheDocument();
    }
    // And none of the other table's vocabulary, which this enum rejects outright.
    expect(screen.queryByText("Mechanical stop")).not.toBeInTheDocument();
  });

  it("writes the enum value the column accepts, not the label a person read", async () => {
    const onDraftChange = vi.fn();
    renderHarness(undefined, onDraftChange);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: " " });

    fireEvent.click(await screen.findByRole("option", { name: "No raw material" }));

    await waitFor(() => expect(onDraftChange).toHaveBeenCalled());
    const last = onDraftChange.mock.calls[onDraftChange.mock.calls.length - 1][0] as ScorecardEntryDraft;
    expect(last.downtime_reason).toBe("Falta de Materia Prima");
  });

  it("asks production about this leader's shifts, not the whole line's week", async () => {
    // `_leader_id` is DEFAULT NULL in the database, and omitting it makes the function
    // sum the entire line — it answers without error either way, so nothing but an
    // assertion on the arguments notices. The call was missing this argument until
    // 7cc1c3a0; the fix arrived without a test, which is how it would come back.
    mockRpcData = [{ planned_volume: 1000, actual_volume: 950, unplanned_downtime_minutes: 30, source_label: "RAG Weekly" }];
    renderHarness(undefined, undefined, "leader-7");

    await screen.findByText(/production recorded 950/i);
    const call = rpcCalls.find((c) => c.name === "scorecard_derived_volume");
    expect(call).toBeDefined();
    expect(call!.params).toMatchObject({
      _line_id: "line-1",
      _week_ending: "2026-07-05",
      _leader_id: "leader-7",
    });
  });

  it("gives two leaders of the same line and week their own numbers, not one shared total", async () => {
    // Line 1, week ending 12/09/2026, as the database actually holds it.
    mockRpcByLeader = {
      "leader-day": [{ planned_volume: 22079, actual_volume: 14573, unplanned_downtime_minutes: 0, source_label: "RAG Weekly (turnos deste lider)" }],
      "leader-night": [{ planned_volume: 4994, actual_volume: 6093, unplanned_downtime_minutes: 0, source_label: "RAG Weekly (turnos deste lider)" }],
    };

    const day = renderHarness(undefined, undefined, "leader-day");
    expect(await screen.findByText(/production recorded 14573/i)).toBeInTheDocument();
    day.unmount();

    renderHarness(undefined, undefined, "leader-night");
    expect(await screen.findByText(/production recorded 6093/i)).toBeInTheDocument();
    // The other leader's figure must not reach this drawer — not from the RPC, and not
    // from a query cache keyed without the leader.
    expect(screen.queryByText(/production recorded 14573/i)).not.toBeInTheDocument();
  });

  it("does not offer a planned volume of zero, which the table refuses anyway", async () => {
    mockRpcData = [{ planned_volume: 0, actual_volume: 3644, unplanned_downtime_minutes: 30, source_label: "RAG Weekly (turnos deste lider)" }];
    renderHarness();

    expect(await screen.findByText(/no planned volume for this leader's shifts/i)).toBeInTheDocument();
    expect(screen.queryByText(/production recorded 0/i)).not.toBeInTheDocument();
    // No offer means no button on that field: the other two keep theirs.
    expect(screen.getAllByRole("button", { name: /use this number/i })).toHaveLength(2);
    expect(screen.getByText(/production recorded 3644/i)).toBeInTheDocument();
    expect(screen.getByText(/production recorded 30/i)).toBeInTheDocument();
  });

  it("still offers a zero that IS a fact — no unplanned downtime is a real result", async () => {
    // The guard above is about one column's CHECK, not about zeros in general. Folding a
    // genuine 0 back into "nothing recorded" is the blank-vs-zero confusion this module
    // exists to refuse.
    mockRpcData = [{ planned_volume: 1000, actual_volume: 950, unplanned_downtime_minutes: 0, source_label: "RAG Weekly" }];
    renderHarness();

    const offer = await screen.findByText(/production recorded 0/i);
    fireEvent.click(offer.parentElement!.querySelector("button") as HTMLButtonElement);

    const downtime = screen.getByLabelText("Unplanned downtime (minutes)") as HTMLInputElement;
    await waitFor(() => expect(downtime.value).toBe("0"));
  });

  it("bounds the numeric boxes the way the database does", () => {
    renderHarness();
    // CHECK (planned_volume > 0): a planned zero is not a plan.
    expect(screen.getByLabelText("Planned volume")).toHaveAttribute("min", "1");
    expect(screen.getByLabelText("Actual volume")).toHaveAttribute("min", "0");
    expect(screen.getByLabelText("Unplanned downtime (minutes)")).toHaveAttribute("min", "0");
  });
});
