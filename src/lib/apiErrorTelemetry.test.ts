import { describe, it, expect, beforeEach, vi } from "vitest";
import { installApiErrorTelemetry } from "@/lib/apiErrorTelemetry";
import { logSystemError } from "@/lib/telemetry";

vi.mock("@/lib/telemetry", () => ({ logSystemError: vi.fn() }));

const logged = vi.mocked(logSystemError);

/** Reinstall over a stub `fetch` that answers with one body and status. */
function serving(body: unknown, status = 409) {
  (window as unknown as { __apiErrorTelemetryInstalled?: boolean }).__apiErrorTelemetryInstalled =
    false;
  window.fetch = vi.fn(async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  ) as unknown as typeof window.fetch;
  installApiErrorTelemetry();
}

const REST = "https://x.supabase.co/rest/v1/sku_products";
const dup = (constraint: string) => ({
  code: "23505",
  message: `duplicate key value violates unique constraint "${constraint}"`,
});

describe("what the interceptor calls a fault", () => {
  beforeEach(() => logged.mockClear());

  it("files a duplicate SKU code as the user's, not the system's", async () => {
    serving(dup("sku_products_code_key"));
    await window.fetch(REST, { method: "POST" });
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged.mock.calls[0][0]).toBe("USER_ERROR");
  });

  it("keeps the whole message, so the log is still evidence", async () => {
    // Not a fault is not the same as not worth knowing. Three of these in four minutes
    // is what said the screen needed to name the SKU already holding the code.
    serving(dup("sku_products_code_key"));
    await window.fetch(REST, { method: "POST" });
    expect(logged.mock.calls[0][1]).toContain("sku_products_code_key");
    expect(logged.mock.calls[0][2]?.metadata).toMatchObject({ status: 409, code: "23505" });
  });

  it("still files the leader constraint as a fault", async () => {
    serving(dup("daily_allocations_one_leader_per_area"));
    await window.fetch("https://x.supabase.co/rest/v1/daily_allocations", { method: "POST" });
    expect(logged.mock.calls[0][0]).toBe("API_ERROR");
  });

  it("still files a constraint nobody has ruled on as a fault", async () => {
    serving(dup("something_new_key"));
    await window.fetch(REST, { method: "POST" });
    expect(logged.mock.calls[0][0]).toBe("API_ERROR");
  });

  it("leaves a denial alone — a 401 is never the user's typing", async () => {
    serving({ message: "permission denied" }, 401);
    await window.fetch(REST, { method: "POST" });
    expect(logged.mock.calls[0][0]).toBe("RLS_ERROR");
  });

  it("says nothing about a request that worked", async () => {
    serving({ ok: true }, 200);
    await window.fetch(REST, { method: "POST" });
    expect(logged).not.toHaveBeenCalled();
  });

  // Recorded, not dropped: the probe is not a fault, but the migration really has
  // not landed. `SCHEMA_DRIFT` is the whole point of the distinction — see the
  // block below and `schemaProbes.ts`.
  it("does not file schema-probe missing columns as API errors", async () => {
    serving({ message: "column quality_options.is_gate does not exist" }, 400);
    await window.fetch("https://x.supabase.co/rest/v1/quality_options?select=is_gate", { method: "GET" });
    expect(logged.mock.calls[0]?.[0]).not.toBe("API_ERROR");
  });
});

const UNDEFINED_COLUMN = (col: string) => ({
  code: "42703",
  message: `column ${col} does not exist`,
});

describe("a read that probes for a column the code can live without", () => {
  beforeEach(() => logged.mockClear());

  // `selectOptions` in useQualityOptions.ts asks for the newest columns first and walks
  // down a rung at a time. On a database missing 20260824090000 the top rungs 400 by
  // design, the ladder catches them, and the screen renders the right answer. Filing
  // those as faults puts a wolf in the list on every route the root-level sync runs on,
  // which is all of them.
  it("does not file the gate probe as a fault", async () => {
    serving(UNDEFINED_COLUMN("quality_options.is_gate"), 400);
    await window.fetch("https://x.supabase.co/rest/v1/quality_options?select=kind,value,points,is_gate");
    expect(logged.mock.calls[0][0]).toBe("SCHEMA_DRIFT");
  });

  it("still records it — the migration really has not landed", async () => {
    serving(UNDEFINED_COLUMN("quality_options.is_gate"), 400);
    await window.fetch("https://x.supabase.co/rest/v1/quality_options?select=is_gate");
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged.mock.calls[0][1]).toContain("quality_options.is_gate");
    expect(logged.mock.calls[0][2]?.metadata).toMatchObject({ code: "42703" });
  });

  it("keeps an undeclared missing column a fault", async () => {
    serving(UNDEFINED_COLUMN("quality_actions.scoring_version_id"), 400);
    await window.fetch("https://x.supabase.co/rest/v1/quality_actions?select=scoring_version_id");
    expect(logged.mock.calls[0][0]).toBe("API_ERROR");
  });

  // No ladder walks down a write. A POST naming a column that is not there is a screen
  // sending the database something it should never have sent.
  it("keeps a write naming the same column a fault", async () => {
    serving(UNDEFINED_COLUMN("quality_options.is_gate"), 400);
    await window.fetch("https://x.supabase.co/rest/v1/quality_options", { method: "POST" });
    expect(logged.mock.calls[0][0]).toBe("API_ERROR");
  });
});
