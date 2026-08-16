import { describe, it, expect } from "vitest";
import { stageMoveError } from "@/hooks/useWorkOrders";

/**
 * What a drop on the maintenance board is allowed to mean.
 *
 * The board moves an order one stage at a time so the timestamps the KPIs read are
 * never left null. Closing is the exception: it is not a stage, it is a sign-off, and
 * it carries a name that only a person can type.
 */
describe("stageMoveError", () => {
  it("allows a move one stage forward", () => {
    expect(stageMoveError("open", "received")).toBeNull();
    expect(stageMoveError("in_progress", "finished")).toBeNull();
  });

  it("allows a move one stage back so a mis-drop can be undone", () => {
    expect(stageMoveError("in_progress", "received")).toBeNull();
  });

  it("refuses to skip a stage, and names the one to use", () => {
    // open -> received -> in_progress -> finished. The next one is received.
    expect(stageMoveError("open", "finished")).toMatch(/received/i);
    expect(stageMoveError("received", "finished")).toMatch(/in progress/i);
  });

  it("refuses to close, and sends the user to Sign off", () => {
    // The whole point. Dragging onto Done wrote {status:'closed', closed_at} and
    // nothing else: no closed_by, no operator_signature_name, and no line resume.
    // In the record that is indistinguishable from an order nobody reviewed.
    const msg = stageMoveError("finished", "closed");
    expect(msg).toMatch(/sign off/i);
  });

  it("refuses to close from any stage, not just the adjacent one", () => {
    expect(stageMoveError("in_progress", "closed")).toMatch(/sign off/i);
    expect(stageMoveError("open", "closed")).toMatch(/sign off/i);
  });

  it("still allows reopening a closed order by dragging it back", () => {
    // Backwards is how a mis-drop is undone, and closing is what needed guarding —
    // not opening. A reopened order can then be signed off properly.
    expect(stageMoveError("closed", "finished")).toBeNull();
  });

  it("treats a move to the same stage as nothing to do", () => {
    expect(stageMoveError("received", "received")).toBeNull();
  });
});
