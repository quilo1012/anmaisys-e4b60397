import "@testing-library/jest-dom";

// jsdom ships no ResizeObserver, and two things the app renders everywhere need one:
// input-otp (every PIN field) and recharts' ResponsiveContainer (every chart). Without
// it those components throw on mount, so any test that renders a real screen fails
// before it can assert anything. A no-op is enough — jsdom performs no layout, so
// there is never a resize to report.
if (!("ResizeObserver" in globalThis)) {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// input-otp looks for a password-manager badge on a timer, by hit-testing a point.
// jsdom has no hit testing, so the timer fired an uncaught TypeError AFTER the test
// that mounted the field had already passed — which reads as a failure in whichever
// test happened to be running next.
if (typeof document !== "undefined" && !document.elementFromPoint) {
  document.elementFromPoint = () => null;
}

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
