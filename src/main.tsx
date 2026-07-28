import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { installDomTranslateGuard } from "@/lib/domTranslateGuard";

// Keep browser auto-translation (Google Translate / Safari) from white-screening
// the app by mutating React-managed DOM nodes. Must run before the first render.
installDomTranslateGuard();

createRoot(document.getElementById("root")!).render(<App />);
