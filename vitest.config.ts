import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    /**
     * 15s, up from the 5s default.
     *
     * The suite fails about one run in three, and never the same tests twice. It is not
     * a logic bug: the failures are `Test timed out in 5000ms` on tests that then report
     * having taken 8781ms and 9098ms — and PersonDayDialog's "cannot be changed by
     * somebody who only reads the board" is SYNCHRONOUS. A test with no await in it
     * cannot take nine seconds on its own merits. It was starved of CPU while 182 files
     * each stood up their own jsdom.
     *
     * The measurement that matters is not the failures, it is the passes: on a good run,
     * component tests here come in at 3.0s, 3.4s, 4.2s, 4.5s and 4.7s. Those passed with
     * a fifth of a second to spare. That is not a margin, it is a coin toss, and which
     * test loses it changes every run.
     *
     * WHAT WAS TRIED AND REJECTED: capping workers. Three runs at the default took 77s,
     * 87s and 131s and one limited to four workers took 58s, which looked like proof
     * that the parallelism was costing more than it earned. It was not — those numbers
     * were taken while the machine was busy with other work. Measured back to back
     * afterwards, eight workers ran in 55s and four in 64s, the opposite way round. So
     * the worker count stays at the default, because nothing here establishes that
     * changing it helps.
     *
     * This raises the ceiling and does not hide anything: a test that genuinely hangs
     * still fails, three times later than before. What it stops failing on is a busy
     * afternoon.
     */
    testTimeout: 15_000,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
