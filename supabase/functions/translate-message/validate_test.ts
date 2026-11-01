import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { validateBody, MAX_TEXT_LENGTH } from "./validate.ts";

Deno.test("empty or missing text is a 400 with a reason", () => {
  for (const body of [null, "x", {}, { text: "" }, { text: "   " }, { text: 5 }]) {
    const r = validateBody(body);
    assertEquals(r.ok, false);
    if (!r.ok) assertEquals(r.status, 400);
  }
});

Deno.test("too-long text is a 400", () => {
  const r = validateBody({ text: "a".repeat(MAX_TEXT_LENGTH + 1) });
  assertEquals(r.ok, false);
});

Deno.test("unknown mode is a 400; known modes pass", () => {
  assertEquals(validateBody({ text: "hi", mode: "french" }).ok, false);
  assertEquals(validateBody({ text: "hi", mode: "polish" }).ok, true);
  assertEquals(validateBody({ text: "hi", mode: "part_search" }).ok, true);
  assertEquals(validateBody({ text: "hi" }).ok, true);
});
