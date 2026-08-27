import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { installDomTranslateGuard } from "@/lib/domTranslateGuard";
import { installApiErrorTelemetry } from "@/lib/apiErrorTelemetry";

// Keep browser auto-translation (Google Translate / Safari) from white-screening
// the app by mutating React-managed DOM nodes. Must run before the first render.
installDomTranslateGuard();

// Auto-capture backend failures (RLS denials, API/edge-function errors) that
// reach the client, so Root Diagnostics sees them without per-screen wiring.
installApiErrorTelemetry();

createRoot(document.getElementById("root")!).render(<App />);

// Register the service worker on load. It used to be registered only from
// usePushNotifications, and only once the user accepted the push toast — so
// anyone who dismissed that toast silently lost the ability to install the app
// as well, since a browser will not offer installation without a registered
// worker. The two were coupled for no reason.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      /* installability and push both degrade gracefully; nothing to report */
    });
  });
}

