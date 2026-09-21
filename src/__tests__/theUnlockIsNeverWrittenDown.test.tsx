import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AdminPinGate } from "@/components/AdminPinGate";
import { AdminPinProvider } from "@/contexts/AdminPinContext";

/**
 * The second door opened with one line in the console.
 *
 * The gate in front of payroll kept its answer in `sessionStorage['pin-ok:workforce']`,
 * so `sessionStorage.setItem('pin-ok:workforce', '1')` walked straight past it. That is
 * the whole lock: no PIN, no request, no trace. For a door whose stated purpose is the
 * laptop left open in the office — where whoever sits down has the browser's own
 * devtools — a secret the browser is holding for them is not a secret.
 *
 * So the unlock stops being written down at all. It lives in `AdminPinProvider`, in
 * React state, and dies with the page. Two things follow, and both are deliberate:
 * a refresh asks again, and a second tab asks again. What does NOT change is moving
 * between the five screens of the section, because a PIN typed four times an hour
 * stops being a lock and becomes a habit somebody works around.
 *
 * WHAT THIS DOES NOT DO: it does not put the PIN in front of the DATA. Attendance and
 * Finance Close still read `employees`, `attendance_days` and `overtime_entries` with
 * the user's own JWT, and RLS lets an admin have them. Anyone willing to write a
 * PostgREST call by hand still gets the rows without ever seeing this screen. This
 * raises the cost of walking through the door; it does not brick up the wall beside it.
 */

const GATE = resolve(__dirname, "../components/AdminPinGate.tsx");

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) },
  },
}));

/**
 * Types a PIN into the FIRST keypad on the page and presses its Unlock.
 *
 * "First" matters: two of the tests below mount two gates at once, and both draw an
 * Unlock. Reaching for it through `screen` finds them both and throws, which reads as
 * a broken gate rather than a test asking the wrong question.
 */
async function typePinAndSubmit(container: HTMLElement, pin = "1234") {
  const input = container.querySelector("input");
  expect(input).not.toBeNull();
  fireEvent.change(input!, { target: { value: pin } });
  const botao = within(container).getAllByRole("button", { name: /unlock/i })[0];
  await waitFor(() => expect(botao).not.toBeDisabled());
  fireEvent.click(botao);
}

const gate = (key = "workforce", child = "os salários") => (
  <AdminPinGate storageKey={key} title="Time & Attendance" description="PIN needed">
    <p>{child}</p>
  </AdminPinGate>
);

describe("the unlock is never written down", () => {
  let setSession: ReturnType<typeof vi.spyOn>;
  let setLocal: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    setSession = vi.spyOn(Storage.prototype, "setItem");
    setLocal = vi.spyOn(window.localStorage.__proto__, "setItem");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ valid: true }),
    })));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("has no code left in the gate that touches browser storage", () => {
    // The assertion that defines this change. `sessionStorage.setItem` is one line, it
    // reads like a convenience, and it is exactly the line that has to stay gone.
    //
    // Comments are stripped first, on purpose: the file's own docstring explains why
    // the storage went away, and a test that forbade the WORD would forbid explaining
    // it — which is how the reason gets deleted a year from now by somebody tidying up.
    const src = readFileSync(GATE, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(src).not.toMatch(/sessionStorage/);
    expect(src).not.toMatch(/localStorage/);
  });

  it("starts locked, and shows the keypad instead of the payroll", () => {
    const { container } = render(<AdminPinProvider>{gate()}</AdminPinProvider>);
    expect(screen.queryByText("os salários")).toBeNull();
    expect(container.querySelector("input")).not.toBeNull();
  });

  it("opens on a PIN the server accepts", async () => {
    const { container } = render(<AdminPinProvider>{gate()}</AdminPinProvider>);
    await typePinAndSubmit(container);
    expect(await screen.findByText("os salários")).toBeInTheDocument();
  });

  it("writes nothing to sessionStorage or localStorage along the way", async () => {
    const { container } = render(<AdminPinProvider>{gate()}</AdminPinProvider>);
    await typePinAndSubmit(container);
    await screen.findByText("os salários");

    const escritas = [
      ...setSession.mock.calls.map((c) => String(c[0])),
      ...setLocal.mock.calls.map((c) => String(c[0])),
    ];
    expect(escritas.filter((k) => k.includes("pin"))).toEqual([]);
    expect(sessionStorage.getItem("pin-ok:workforce")).toBeNull();
    expect(localStorage.getItem("pin-ok:workforce")).toBeNull();
  });

  it("is locked again on a fresh page, because nothing survived it", async () => {
    const primeira = render(<AdminPinProvider>{gate()}</AdminPinProvider>);
    await typePinAndSubmit(primeira.container);
    await screen.findByText("os salários");
    primeira.unmount();

    // A new provider is a new page: a refresh, or a second tab. Both ask again now,
    // and that is the point — what the browser does not hold cannot be handed over.
    render(<AdminPinProvider>{gate()}</AdminPinProvider>);
    expect(screen.queryByText("os salários")).toBeNull();
  });

  it("does not ask twice for the same section on the same page", async () => {
    // The five screens under `workforce` are one door, not five. Unlocking Attendance
    // has to open Finance Close, or the lock turns into the habit it was meant not to be.
    const { container } = render(
      <AdminPinProvider>
        {gate("workforce", "attendance")}
        {gate("workforce", "finance close")}
      </AdminPinProvider>,
    );
    await typePinAndSubmit(container);
    expect(await screen.findByText("attendance")).toBeInTheDocument();
    expect(await screen.findByText("finance close")).toBeInTheDocument();
  });

  it("keeps another section shut", async () => {
    const { container } = render(
      <AdminPinProvider>
        {gate("workforce", "attendance")}
        {gate("outra-seccao", "outra coisa")}
      </AdminPinProvider>,
    );
    await typePinAndSubmit(container);
    await screen.findByText("attendance");
    expect(screen.queryByText("outra coisa")).toBeNull();
  });
});
