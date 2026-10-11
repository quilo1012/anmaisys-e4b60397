import { describe, it, expect } from "vitest";
import QRCode from "qrcode";
import { qrPath, writeSignupLabel, SIGNUP_LABEL_CSS } from "@/lib/signupLabel";

const PAYLOAD = "https://anmaisys.lovable.app/signup?code=AN-7KX4PQ";

describe("qrPath", () => {
  it("draws exactly the code's dark modules, one unit square each", () => {
    const { size, d } = qrPath(PAYLOAD);
    const { modules } = QRCode.create(PAYLOAD, { errorCorrectionLevel: "M" });
    expect(size).toBe(modules.size);
    // Each run is "M x y h n v1 h -n z": sum the run lengths back to a module count.
    const runs = [...d.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)];
    const covered = runs.reduce((n, r) => n + Number(r[3]), 0);
    const dark = Array.from(modules.data).filter(Boolean).length;
    expect(covered).toBe(dark);
    // And nothing else in the path — no strokes, no half-pixel offsets.
    expect(d.replace(/M\d+ \d+h\d+v1h-\d+z/g, "")).toBe("");
  });
});

describe("the printed label", () => {
  it("takes the paper the printer has loaded rather than asking for A4", () => {
    const page = SIGNUP_LABEL_CSS.match(/@page\s*{[^}]*}/)![0];
    expect(page).toContain("margin: 0");
    // A size here is what made Chrome shrink an A4 page onto the Zebra label.
    expect(page).not.toMatch(/size/);
  });

  it("is black on white only — a thermal head prints a dot or no dot", () => {
    const colours = SIGNUP_LABEL_CSS.match(/#[0-9a-f]{3,6}\b/gi) ?? [];
    expect(new Set(colours.map((c) => c.toLowerCase()))).toEqual(new Set(["#fff", "#000"]));
  });

  it("writes the invite code as text, never as markup", () => {
    const doc = document.implementation.createHTMLDocument("");
    writeSignupLabel(doc, { payload: PAYLOAD, code: "<img src=x onerror=alert(1)>" });
    expect(doc.querySelector("img")).toBeNull();
    expect(doc.querySelector(".code b")!.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(doc.querySelector("svg.qr path")!.getAttribute("fill")).toBe("#000");
    expect(doc.title).toBe("Create your account");
  });
});
