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
