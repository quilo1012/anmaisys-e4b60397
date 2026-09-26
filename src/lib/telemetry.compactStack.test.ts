import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { compactStack } from "./telemetry";

describe("compactStack", () => {
  it("keeps the frames that started a stack overflow", () => {
    const top = ["@app:190:70", "@app:197:363", "@app:190:41", "@app:198:237"];
    const loop = Array.from({ length: 2000 }, () => ["Qk@app:226:408", "Ok@app:226:63"]).flat();
    const origin = ["handleClick@app:900:12", "dispatch@app:50:1"];
    const out = compactStack([...top, ...loop, ...origin].join("\n"));
    expect(out.length).toBeLessThanOrEqual(6000);
    expect(out).toContain("handleClick@app:900:12");
    expect(out).toContain("repeated 2000×");
    expect(out.startsWith("@app:190:70")).toBe(true);
  });

  it("leaves a short, ordinary stack untouched", () => {
    const s = "Error: x\n@a:1:1\n@b:2:2\n@c:3:3";
    expect(compactStack(s)).toBe(s);
  });

  it("keeps head and tail when nothing repeats and it is still too long", () => {
    const s = Array.from({ length: 1000 }, (_, i) => `f${i}@app:${i}:1`).join("\n");
    const out = compactStack(s);
    expect(out.length).toBeLessThanOrEqual(6000);
    expect(out).toContain("f0@app:0:1");
    expect(out).toContain("f999@app:999:1");
    expect(out).toContain("chars cut");
  });
});
