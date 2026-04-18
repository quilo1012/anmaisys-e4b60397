// Temporary edge function to generate VAPID keys for Web Push.
// Run once, copy the output, save as Supabase secrets, then delete this function.
import { corsHeaders } from "@supabase/supabase-js/cors";
import webpush from "npm:web-push@3.6.7";

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const keys = webpush.generateVAPIDKeys();
  return new Response(
    JSON.stringify({
      VAPID_PUBLIC_KEY: keys.publicKey,
      VAPID_PRIVATE_KEY: keys.privateKey,
      VAPID_SUBJECT: "mailto:admin@anmaintenance.com",
      instructions: [
        "1. Copy VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.",
        "2. Add them as Supabase secrets in Lovable Cloud settings.",
        "3. Also add VITE_VAPID_PUBLIC_KEY (same value as VAPID_PUBLIC_KEY) so the frontend can subscribe.",
        "4. Delete this generate-vapid-keys function after saving.",
      ],
    }, null, 2),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
