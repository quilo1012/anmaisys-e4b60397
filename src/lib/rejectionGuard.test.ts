import { describe, it, expect } from "vitest";
import {
  rejectionReasonProblem, concernInDescription, reasonProblemFor,
} from "@/lib/rejectionGuard";

const GOOD = "Checked with Marco on the day shift, guard was already refitted and the machine tested clear.";

describe("rejectionReasonProblem", () => {
  it("turns away the two reasons that were actually used", () => {
    // "Ooo" and "..." both cleared the old three-character gate. One closed a metal
    // detection on Line 1; the other closed a report of an electric shock.
    expect(rejectionReasonProblem("Ooo")).not.toBeNull();
    expect(rejectionReasonProblem("...")).not.toBeNull();
  });

  it("turns away the things that pass a length check and say nothing", () => {
    expect(rejectionReasonProblem("aaaaaaaaaaaaaaaaaaaa")).not.toBeNull();
    expect(rejectionReasonProblem("................................")).not.toBeNull();
    expect(rejectionReasonProblem("ok ok ok ok ok ok ok ok")).not.toBeNull();
    expect(rejectionReasonProblem("asdf asdf asdf asdf asdf")).not.toBeNull();
  });

  it("accepts an account somebody could follow", () => {
    expect(rejectionReasonProblem(GOOD)).toBeNull();
    expect(rejectionReasonProblem("Duplicate of WO-000712, same fault already open")).toBeNull();
  });

  it("says what is wrong rather than quoting a rule", () => {
    // "min 3 characters" to somebody who typed three characters is the message that
    // taught everybody to type "Ooo".
    expect(rejectionReasonProblem("no")).toMatch(/reason|words|found/i);
  });
});

describe("concernInDescription", () => {
  it("catches the two reports that were rejected", () => {
    expect(concernInDescription("Capsule polisher 2 giving electric shock. Needs fixing!")).toBe("safety");
    expect(concernInDescription("Metal Detected")).toBe("contamination");
  });

  it("reads the floor's other language too", () => {
    expect(concernInDescription("choque elétrico na máquina")).toBe("safety");
    expect(concernInDescription("corpo estranho no produto")).toBe("contamination");
  });

  it("leaves ordinary work alone", () => {
    expect(concernInDescription("Capper fault, machine stopping intermittently")).toBeNull();
    expect(concernInDescription("Label misaligned on Line 3")).toBeNull();
    expect(concernInDescription("")).toBeNull();
    expect(concernInDescription(null)).toBeNull();
  });
});

describe("reasonProblemFor", () => {
  it("asks for more on a safety report than on ordinary work", () => {
    const short = "Duplicate of WO-000712";
    expect(reasonProblemFor("Capper fault", short)).toBeNull();
    expect(reasonProblemFor("giving electric shock", short)).not.toBeNull();
  });

  it("accepts a full account of who checked a safety report", () => {
    expect(reasonProblemFor("giving electric shock", GOOD)).toBeNull();
  });

  it("still rejects an empty reason whatever the report is", () => {
    expect(reasonProblemFor("Capper fault", "Ooo")).not.toBeNull();
    expect(reasonProblemFor("Metal Detected", "Ooo")).not.toBeNull();
  });
});
