import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * The notice exists because the silent case is the dangerous one: a message that writes
 * the bell, stops at `if not exists (… push_subscriptions …) then return null`, and
 * looks delivered from the sending side.
 *
 * The risk the other way is just as real, and it is what most of these tests are about:
 * `push_coverage()` returns nothing to a caller who may not manage overtime, and nothing
 * is not "nobody has a phone". Drawing the warning on a missing answer would put
 * "they won't be notified" under every conversation in the Hub, which is both false and
 * the fastest way to teach people to ignore it.
 */

const coverage = vi.hoisted(() => ({ data: null as unknown }));
vi.mock("@/hooks/usePushCoverage", () => ({ usePushCoverage: () => coverage }));

const { PushReachNotice } = await import("./PushReachNotice");

const warned = () => screen.queryByRole("status") !== null;

describe("telling the sender their message will not buzz", () => {
  it("warns when the recipient has no phone registered", () => {
    coverage.data = new Map([["someone-else", { phones: 1, platforms: ["Android/Chrome"], lastRegistered: null }]]);
    render(<PushReachNotice recipientId="no-phone" name="Alice Kovac" />);
    expect(warned()).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("Alice Kovac");
  });

  it("says nothing when the recipient has a phone", () => {
    coverage.data = new Map([["has-phone", { phones: 2, platforms: ["iPhone/iPad"], lastRegistered: null }]]);
    render(<PushReachNotice recipientId="has-phone" name="Felipe Pinelli" />);
    expect(warned()).toBe(false);
  });

  it("says nothing when the question could not be asked", () => {
    // Null is "no answer" — not "no phones". A reader without the overtime permission
    // gets null, and must not be told every colleague is unreachable.
    coverage.data = null;
    render(<PushReachNotice recipientId="no-phone" name="Alice Kovac" />);
    expect(warned()).toBe(false);
  });

  it("falls back to neutral wording when the name is missing", () => {
    coverage.data = new Map();
    render(<PushReachNotice recipientId="no-phone" />);
    expect(screen.getByRole("status").textContent).toMatch(/^This person/);
  });

  it("does not claim the message was lost", () => {
    // It arrives. It just does not buzz — and the difference is the whole point:
    // a supervisor who thinks the message failed will send it twice by another route.
    coverage.data = new Map();
    render(<PushReachNotice recipientId="no-phone" name="Alice" />);
    expect(screen.getByRole("status").textContent).toMatch(/open the app/i);
  });
});
