import { useEffect } from "react";
import { RefreshCw, WifiOff } from "lucide-react";
import { useAppUpdater } from "@/hooks/useAppUpdater";
import { useOfflineDetection } from "@/hooks/useOfflineQueue";

/**
 * The two things the whole app has to be able to say, wherever you are in it:
 * a new build is waiting, and the server cannot be reached.
 *
 * Both used to live somewhere that could not say them everywhere. The update
 * banner was `fixed top-0 z-[200]` in App with nothing moving out from under it,
 * so it covered the header — sidebar toggle, Back, title, both bells — and on a
 * kiosk tablet there was no browser chrome to escape through. The offline banner
 * was inside DashboardLayout, and the two screens where it matters most
 * (`/dashboard/line-production`, where production is WRITTEN, and the wall
 * display) do not use that layout at all, so the operator entering numbers into a
 * dead connection was the one person never told.
 *
 * Now there is one stack, mounted once at the top of the app, and it reserves its
 * own height: `data-app-banner` on <html> carries how many bars are showing and
 * `--app-banner-h` in index.css turns that into space. The shell subtracts it from
 * its own height; every other screen is pushed down by the padding on #root.
 */
export function AppBanners() {
  const { updateReady, reloadNow } = useAppUpdater();
  const { isOnline } = useOfflineDetection();

  const count = (updateReady ? 1 : 0) + (isOnline ? 0 : 1);

  useEffect(() => {
    const root = document.documentElement;
    if (count > 0) root.dataset.appBanner = String(count);
    else delete root.dataset.appBanner;
    return () => {
      delete root.dataset.appBanner;
    };
  }, [count]);

  if (count === 0) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-[200] flex flex-col print:hidden">
      {!isOnline && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-destructive px-4 py-2.5 text-center text-destructive-foreground shadow-lg"
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
            No connection to the server
          </span>
          <span className="text-sm">
            Nothing you save will be stored — what you have typed stays on screen.
          </span>
        </div>
      )}

      {updateReady && (
        // Prominent and unmissable on purpose: kiosk tablets miss subtle toasts.
        // The app still auto-reloads once idle; this lets the person do it on demand
        // rather than sitting on a stale build.
        <div
          role="alert"
          className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-primary px-4 py-2.5 text-primary-foreground shadow-lg"
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <RefreshCw className="h-4 w-4 shrink-0" aria-hidden="true" />
            A new version is available
          </span>
          <button
            type="button"
            onClick={reloadNow}
            className="min-h-11 rounded-md bg-primary-foreground px-4 text-sm font-bold text-primary hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-primary"
          >
            Update now
          </button>
        </div>
      )}
    </div>
  );
}
