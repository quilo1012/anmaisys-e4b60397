// Injects `x-device-token` into every fetch() request to Supabase.
// This is needed because src/integrations/supabase/client.ts is auto-generated
// and we can't pass a custom fetch through createClient() there.

const DEVICE_TOKEN_KEY = "an_device_token";
const SUPABASE_HOST = (import.meta.env.VITE_SUPABASE_URL || "").replace(/^https?:\/\//, "");

function getOrCreateDeviceToken(): string {
  let t = localStorage.getItem(DEVICE_TOKEN_KEY);
  if (!t) {
    const arr = new Uint8Array(18);
    crypto.getRandomValues(arr);
    t = btoa(String.fromCharCode(...arr)).replace(/[+/=]/g, "").slice(0, 24);
    localStorage.setItem(DEVICE_TOKEN_KEY, t);
  }
  return t;
}

export function installDeviceFetch() {
  if (!SUPABASE_HOST) return;
  const originalFetch = window.fetch.bind(window);

  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;

      // Inject x-device-token only on REST/RPC calls. Edge Functions don't need
      // it, and adding a custom header forces a CORS preflight that the
      // /functions/v1/ gateway rejects → "Failed to fetch" in the browser.
      if (url.includes(SUPABASE_HOST) && !url.includes("/functions/v1/")) {
        const token = getOrCreateDeviceToken();
        const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
        if (!headers.has("x-device-token")) {
          headers.set("x-device-token", token);
        }
        return originalFetch(input, { ...init, headers });
      }
    } catch {
      // Fall through to plain fetch on any error
    }
    return originalFetch(input, init);
  };
}
