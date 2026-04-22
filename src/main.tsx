import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { installDeviceFetch } from "./lib/deviceFetch";

// Must run before any Supabase request so RLS can read x-device-token
installDeviceFetch();

createRoot(document.getElementById("root")!).render(<App />);
