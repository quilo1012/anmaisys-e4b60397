import { describe, expect, it } from "vitest";
import { publicOrigin, PUBLISHED_ORIGIN } from "./publicOrigin";

describe("publicOrigin — the address a scanned QR opens", () => {
  it("keeps the published site and a custom domain as they are", () => {
    expect(publicOrigin("https://anpmsystem.co.uk", undefined)).toBe("https://anpmsystem.co.uk");
    expect(publicOrigin("https://pm.appliednutrition.uk/", undefined)).toBe("https://pm.appliednutrition.uk");
  });

  it("swaps the superseded address, so no new QR is minted through the redirect", () => {
    // anmaisys.lovable.app now 302s to the custom domain. A phone that scans a QR
    // carrying it lands on an origin holding none of its localStorage and is asked to
    // sign in again — the redirect is for old links, not for new ones.
    expect(publicOrigin("https://anmaisys.lovable.app", undefined)).toBe(PUBLISHED_ORIGIN);
    expect(publicOrigin("https://anmaisys.lovable.app/", undefined)).toBe(PUBLISHED_ORIGIN);
  });

  it("swaps a Lovable preview for the published site, because a phone cannot open it", () => {
    for (const host of [
      "https://id-preview--3f2b1c4d-1111-4222-8333-944455556666.lovable.app",
      "https://preview--anmaisys.lovable.app",
      "https://3f2b1c4d-1111-4222-8333-944455556666.lovableproject.com",
    ]) {
      expect(publicOrigin(host, undefined)).toBe(PUBLISHED_ORIGIN);
    }
  });

  it("swaps local and LAN addresses too", () => {
    for (const host of ["http://localhost:8080", "http://127.0.0.1:5173", "http://192.168.1.20:8080", "http://10.0.0.4"]) {
      expect(publicOrigin(host, undefined)).toBe(PUBLISHED_ORIGIN);
    }
  });

  it("uses the configured address when there is one", () => {
    expect(publicOrigin("http://localhost:8080", "https://pm.example.com/")).toBe("https://pm.example.com");
  });
});
