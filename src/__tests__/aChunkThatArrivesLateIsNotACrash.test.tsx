import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { Component, Suspense, type ReactNode } from "react";
import { lazyWithReload } from "@/lib/lazyWithReload";

/** Stands in for the app's ErrorBoundary so a deliberate crash does not fail the run. */
class Catch extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <div>crashed</div> : this.props.children;
  }
}

/**
 * A screen that fails to import once is not a broken screen.
 *
 * lazyWithReload has always caught the "Failed to fetch dynamically imported module"
 * that follows a deploy, and its answer was to reload the page. That answer assumes
 * the new build is up. On the preview host it frequently is not: index.html is
 * replaced the instant an edit lands, and the chunk it names goes up a moment later.
 * A reload arriving inside that window fails on the same import again, the
 * once-a-minute throttle then refuses to reload a second time, and the error lands in
 * the ErrorBoundary as a REACT_CRASH — which is exactly what /dashboard/attendance
 * and /dashboard/rag-weekly logged on 06/09 and 07/09.
 *
 * These two tests hold the two halves of the fix apart, because they fail for
 * different reasons: that a late chunk is waited for rather than reloaded through,
 * and that a genuine error inside the module is still raised at once instead of being
 * swallowed by three attempts at it.
 */

const chunkError = () =>
  new TypeError(
    "Failed to fetch dynamically imported module: https://example.lovable.app/assets/AttendancePage-DJUwM4M1.js",
  );

function Screen() {
  return <div>attendance</div>;
}

let reload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  reload = vi.fn();
  // jsdom's location.reload is not configurable in place; replace the accessor.
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, reload },
  });
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a chunk that arrives late", () => {
  it("is retried, and the screen renders without reloading the page", async () => {
    let attempts = 0;
    const Late = lazyWithReload(async () => {
      attempts++;
      if (attempts === 1) throw chunkError();
      return { default: Screen };
    });

    render(
      <Suspense fallback={<div>loading</div>}>
        <Late />
      </Suspense>,
    );

    expect(await screen.findByText("attendance")).toBeTruthy();
    expect(attempts).toBe(2);
    // The whole point: the user's page was never thrown away.
    expect(reload).not.toHaveBeenCalled();
  });

  it("does not retry an error that is not a chunk failure", async () => {
    let attempts = 0;
    const Broken = lazyWithReload(async () => {
      attempts++;
      throw new Error("Cannot read properties of undefined (reading 'map')");
    });

    // React reports the rejection through the boundary; here we only care that the
    // module was asked for exactly once, so a real crash is not delayed by two seconds
    // of retries before anyone is told about it.
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <Catch>
        <Suspense fallback={<div>loading</div>}>
          <Broken />
        </Suspense>
      </Catch>,
    );

    await waitFor(() => expect(attempts).toBe(1));
    expect(reload).not.toHaveBeenCalled();
  });
});
