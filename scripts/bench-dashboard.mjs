#!/usr/bin/env node
/**
 * Dashboard query benchmark.
 *
 * Usage:
 *   node scripts/bench-dashboard.mjs            # run with anon key (RLS applies)
 *   ITERATIONS=10 node scripts/bench-dashboard.mjs
 *
 * Reads VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY from .env.
 * Times the queries used by the manager/operator dashboards so you can
 * compare totals before vs after applying the performance indexes
 * migration (20260623231311_*_performance_indexes.sql).
 *
 * Save a baseline:  node scripts/bench-dashboard.mjs > bench-before.txt
 * Apply migration, then:  node scripts/bench-dashboard.mjs > bench-after.txt
 * Diff the "avg" column.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv() {
  try {
    const txt = readFileSync(".env", "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
    }
  } catch {}
}
loadEnv();

const URL = process.env.VITE_SUPABASE_URL;
const KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!URL || !KEY) {
  console.error("Missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY");
  process.exit(1);
}

const ITER = Number(process.env.ITERATIONS ?? 5);
const supabase = createClient(URL, KEY, { auth: { persistSession: false } });

const cases = [
  ["work_orders: open by line+status", () =>
    supabase.from("work_orders")
      .select("id,wo_number,status,priority,created_at,physical_line_id")
      .in("status", ["OPEN", "IN_PROGRESS", "PAUSED"])
      .order("created_at", { ascending: false })
      .limit(50)],
  ["work_orders: by machine recent", () =>
    supabase.from("work_orders")
      .select("id,wo_number,machine,created_at")
      .order("created_at", { ascending: false })
      .limit(100)],
  ["work_orders: priority+status", () =>
    supabase.from("work_orders")
      .select("id,priority,status")
      .in("priority", ["HIGH", "CRITICAL"])
      .in("status", ["OPEN", "IN_PROGRESS"])
      .limit(100)],
  ["products: low stock", () =>
    supabase.from("products")
      .select("id,name,quantity,min_stock")
      .limit(100)],
  ["audit_logs: recent page", () =>
    supabase.from("audit_logs")
      .select("id,action,entity_type,created_at,user_id")
      .order("created_at", { ascending: false })
      .limit(50)],
  ["machine_events: recent", () =>
    supabase.from("machine_events")
      .select("id,machine_id,event_type,created_at")
      .order("created_at", { ascending: false })
      .limit(100)],
  ["downtime_events: recent", () =>
    supabase.from("downtime_events")
      .select("id,started_at,ended_at,physical_line_id")
      .order("started_at", { ascending: false })
      .limit(100)],
];

async function time(fn) {
  const t0 = performance.now();
  const { error } = await fn();
  const dt = performance.now() - t0;
  return { dt, error };
}

function stats(xs) {
  const sorted = [...xs].sort((a, b) => a - b);
  const avg = xs.reduce((a, b) => a + b, 0) / xs.length;
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? sorted.at(-1);
  return { avg, p50, p95, min: sorted[0], max: sorted.at(-1) };
}

console.log(`Benchmark — ${ITER} iterations per query`);
console.log(`Target: ${URL}\n`);
console.log(
  "query".padEnd(40),
  "avg(ms)".padStart(9),
  "p50".padStart(8),
  "p95".padStart(8),
  "min".padStart(8),
  "max".padStart(8),
  "note",
);
console.log("-".repeat(95));

let total = 0;
for (const [label, fn] of cases) {
  await time(fn); // warmup
  const samples = [];
  let lastErr = null;
  for (let i = 0; i < ITER; i++) {
    const { dt, error } = await time(fn);
    samples.push(dt);
    if (error) lastErr = error.message;
  }
  const s = stats(samples);
  total += s.avg;
  console.log(
    label.padEnd(40),
    s.avg.toFixed(1).padStart(9),
    s.p50.toFixed(1).padStart(8),
    s.p95.toFixed(1).padStart(8),
    s.min.toFixed(1).padStart(8),
    s.max.toFixed(1).padStart(8),
    lastErr ? `ERR: ${lastErr}` : "",
  );
}
console.log("-".repeat(95));
console.log("total avg".padEnd(40), total.toFixed(1).padStart(9), "ms");
