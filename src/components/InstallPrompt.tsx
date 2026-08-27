import { useEffect, useRef } from "react";
import { toast } from "sonner";

const PROMPT_KEY = "an_install_prompted_v1";

/**
 * Invites the user to install the app to their home screen.
 *
 * Two reasons this never appeared before: sw.js had no `fetch` listener, which
 * disqualifies the app from Chrome's install criteria outright, and the service
 * worker was only registered for people who accepted the push toast. Both are
 * fixed elsewhere; this is the invitation itself.
 *
 * Renders nothing — same shape as PushOnboarding.
 */

/** Not in lib.dom yet; Chromium-only. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.matchMedia("(display-mode: standalone)").matches) return true;
  } catch {
    /* matchMedia unavailable — fall through to the iOS flag */
  }
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

function alreadyAsked(): boolean {
  try {
    return localStorage.getItem(PROMPT_KEY) !== null;
  } catch {
    // Private mode or blocked storage: better to stay quiet than to nag on
    // every single page load.
    return true;
  }
}

function markAsked() {
  try {
    localStorage.setItem(PROMPT_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function InstallPrompt() {
  const deferred = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (isStandalone() || alreadyAsked()) return;

    let timer: ReturnType<typeof setTimeout> | undefined;

    const onBeforeInstall = (e: Event) => {
      // Keep the browser's own mini-infobar out of the way so the invitation
      // arrives once, on our terms, worded for the person holding the phone.
      e.preventDefault();
      deferred.current = e as BeforeInstallPromptEvent;

      timer = setTimeout(() => {
        if (isStandalone()) return;
        markAsked();
        toast("Install AN Maintenance?", {
          description:
            "Opens straight from your home screen — no address to type, no signing in again.",
          duration: 15000,
          action: {
            label: "Install",
            onClick: () => {
              const ev = deferred.current;
              deferred.current = null;
              void ev?.prompt();
            },
          },
        });
      }, 2500);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    // Safari never fires beforeinstallprompt, so on iOS the only route is the
    // manual one and it has to be spelled out.
    if (isIOS()) {
      timer = setTimeout(() => {
        if (isStandalone()) return;
        markAsked();
        toast("Add AN Maintenance to your home screen", {
          description:
            "Tap the Share button, then 'Add to Home Screen'. It opens without the address bar and keeps you signed in.",
          duration: 15000,
        });
      }, 2500);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      if (timer) clearTimeout(timer);
    };
  }, []);

  return null;
}
