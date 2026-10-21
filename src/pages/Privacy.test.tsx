import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import Privacy from "@/pages/Privacy";

describe("the privacy page the Play listing links to", () => {
  it("opens without a login and says what is held and who processes it", () => {
    render(<Privacy />);
    expect(screen.getByRole("heading", { name: "Privacy" })).toBeTruthy();
    expect(screen.getAllByText(/Lovable Cloud/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Anthropic/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/voice notes/i).length).toBeGreaterThan(0);
  });

  it("does not show an address nobody has set: it sends people to their supervisor", () => {
    render(<Privacy />);
    expect(screen.getByText(/speak to your supervisor or the system administrator/)).toBeTruthy();
    expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
  });
});
