import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { installDomTranslateGuard } from "@/lib/domTranslateGuard";
import { installApiErrorTelemetry } from "@/lib/apiErrorTelemetry";
import { installStaleJwtRetry } from "@/lib/staleJwtRetry";

// Keep browser auto-translation (Google Translate / Safari) from white-screening
// the app by mutating React-managed DOM nodes. Must run before the first render.
installDomTranslateGuard();

// A request that went out on a token which expired while the tablet slept is refused
// before PostgREST touches anything; refresh and re-issue it once. FIRST, so the
// telemetry wrapper below sees the outcome and not the attempt — a recovered request
// is not a fault, and a refresh that fails still surfaces its 401 to be filed.
installStaleJwtRetry();

// Auto-capture backend failures (RLS denials, API/edge-function errors) that
// reach the client, so Root Diagnostics sees them without per-screen wiring.
installApiErrorTelemetry();

createRoot(document.getElementById("root")!).render(<App />);
