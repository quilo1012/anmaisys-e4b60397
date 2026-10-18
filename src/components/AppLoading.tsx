import { Loader2 } from "lucide-react";

/**
 * The one full-screen "wait" of the app: mark, spinner, and what is being waited for.
 *
 * Four copies of this lived in `ProtectedRoute` and `Index`, and the login screen had
 * none — it drew the form while a stored session was still being read, so somebody
 * already signed in saw the sign-in page flash up before being sent on. Same picture
 * everywhere now, so moving from one wait to the next does not read as a reload.
 */
export function AppLoading({ label }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[100dvh] items-center justify-center bg-background p-4"
    >
      <div className="flex flex-col items-center gap-3 text-center text-muted-foreground">
        <img src="/favicon.png" alt="" aria-hidden="true" className="h-12 w-12 rounded-xl object-contain shadow-lg ring-1 ring-white/10" />
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
        {label ? <span className="text-sm">{label}</span> : <span className="sr-only">Loading</span>}
      </div>
    </div>
  );
}
