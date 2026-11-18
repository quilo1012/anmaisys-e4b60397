import { describe, expect, it } from "vitest";
import { sentWithoutUserToken } from "./requestAuth";

const b64url = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const jwt = (payload: object) => `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.sig`;

const ANON = jwt({ iss: "supabase", ref: "apblxaaktftinstoidvp", role: "anon" });
const USER = jwt({ sub: "c928617c-0000", role: "authenticated", session_id: "s-1" });

describe("sentWithoutUserToken", () => {
  it("is true when the bearer is the anon key supabase-js falls back to", () => {
    expect(sentWithoutUserToken({ headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } })).toBe(true);
  });

  it("reads a Headers object as well as a plain one — supabase-js sends a Headers", () => {
    expect(sentWithoutUserToken({ headers: new Headers({ apikey: ANON, Authorization: `Bearer ${ANON}` }) })).toBe(true);
  });

  it("is true for any anon-role JWT, even when apikey is not the same string", () => {
    expect(sentWithoutUserToken({ headers: { apikey: "sb_publishable_x", Authorization: `Bearer ${ANON}` } })).toBe(true);
  });

  it("is true when only the apikey went", () => {
    expect(sentWithoutUserToken({ headers: { apikey: ANON } })).toBe(true);
  });

  it("is false for a signed-in user's token", () => {
    expect(sentWithoutUserToken({ headers: { apikey: ANON, Authorization: `Bearer ${USER}` } })).toBe(false);
  });

  it("is false when there is nothing to read — still treated as a real refusal", () => {
    expect(sentWithoutUserToken(undefined)).toBe(false);
    expect(sentWithoutUserToken({})).toBe(false);
    expect(sentWithoutUserToken({ headers: { Authorization: "Bearer t" } })).toBe(false);
  });
});
