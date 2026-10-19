import { Link } from "react-router-dom";
import { useSignupQr } from "@/hooks/useSignupQr";
import { tabletSignupPath } from "@/lib/signupQr";
import { publicOrigin } from "@/lib/publicOrigin";

/**
 * Register on your own phone, not on the tablet in front of you.
 *
 * The tablets sign in with a small pool of shared operator accounts — `tablet-signin`
 * takes an `account_id`, and says so in its own comment. A tablet is a place, not a
 * person. Everything downstream of overtime asks who you are through
 * `my_employee_id()`, which reads `employees.user_id = auth.uid()`, so a whole shift
 * answering on one tablet answers as whoever that account is linked to: one row,
 * overwritten each time, and the floor reporting that only one person can sign up.
 *
 * The phone is still the better place, but it is no longer the only one. Since
 * 20261009090000 the database refuses to link a tablet account to anybody, and the
 * registration form opened from here is told it is on a tablet (`?tablet=1`), so it
 * creates the person's account without signing the tablet in as them. Some people have
 * no phone with them at the start of a shift; for them the button below is the way in.
 *
 * The code carries the signup URL and nothing else — see `signupQrPayload`, which has
 * a test naming what it may carry and what it never will. Scanning grants nothing.
 */
export function SignupQrCard({
  origin,
  tone = "auth",
  /**
   * Passed in, never fetched here. This card is drawn on the public login screen as
   * well, and one that looked the code up for itself would carry it wherever it was
   * placed. See `useSignupInviteCode` for where it comes from.
   */
  inviteCode,
}: { origin?: string; tone?: "auth" | "page"; inviteCode?: string | null }) {
  // Scanned by a phone, so the address must be one a phone can open — not the
  // preview or a local dev server the tablet happens to be showing.
  const base = origin ?? publicOrigin();
  const { src, failed } = useSignupQr(base, inviteCode);
  const carriesCode = !!(inviteCode ?? "").trim();

  // The login screen is the dark auth shell and My Overtime is the ordinary page, and
  // `text-auth-ink-muted` on the second is grey on near-white. Two tokens, one card:
  // the alternative was a second copy of it drifting from this one.
  const muted = tone === "auth" ? "text-auth-ink-muted" : "text-muted-foreground";
  const placeholder = tone === "auth" ? "bg-white/10" : "bg-muted";

  // A card promising a code and showing a hole is worse than no card: somebody stands
  // there waiting for it to load. The address is readable either way.
  if (failed || !base) {
    return (
      <p className={`mt-6 text-sm ${muted}`}>
        New here? Open <span className="font-medium">{base ? `${base}/signup` : "/signup"}</span> on
        your phone to register.
      </p>
    );
  }

  // Uma secção do formulário, alinhada à esquerda como ele, e não uma coluna
  // centrada de quatro peças. O QR ao lado do texto cabe no tablet deitado (~600px
  // de altura), onde por baixo ficava fora do ecrã. "Create account" é secundário:
  // neste ecrã o botão cheio é o de entrar, e havia dois azuis a pedir o mesmo dedo.
  const primary = tone === "auth"
    ? "border-auth-line bg-auth-paper text-auth-ink hover:bg-auth-ink/[0.04] focus-visible:ring-auth-brand/40"
    : "border-border bg-background text-foreground hover:bg-muted focus-visible:ring-ring";
  const rule = tone === "auth" ? "border-auth-line" : "border-border";
  const ink = tone === "auth" ? "text-auth-ink" : "text-foreground";
  return (
    <section aria-labelledby="signup-qr-title" className={`mt-6 border-t pt-5 ${rule}`}>
      <div className="flex flex-wrap items-start gap-x-5 gap-y-3">
        {src
          ? <img src={src} alt="QR code to the registration page" className="h-28 w-28 shrink-0 rounded-md border border-black/5 bg-white p-1.5" />
          : <div className={`h-28 w-28 shrink-0 animate-pulse rounded-md ${placeholder}`} aria-hidden />}
        <div className="min-w-[12rem] flex-1">
          <h2 id="signup-qr-title" className={`text-sm font-semibold ${ink}`}>New to the system?</h2>
          <p className={`mt-1 text-sm leading-snug ${muted}`}>
            Scan the code with your own phone to register.
          </p>
          <Link
            to={tabletSignupPath(inviteCode)}
            className={`mt-3 inline-flex h-10 items-center justify-center rounded-lg border px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 ${primary}`}
          >
            Create account here
          </Link>
          {/* What the scan gets you, said before the scan rather than after.
              Without the code the form opens with a box labelled "From your supervisor",
              and somebody who walked away from the tablet to fill it in has no way back
              to find out where it comes from. */}
          <p className={`mt-2 text-xs leading-snug ${muted}`}>
            {carriesCode
              ? "The invite code is already included, so you won't be asked for it. The tablet stays signed in as the line."
              : "You'll need the invite code from the sign-up sheet where you clock in."}
          </p>
        </div>
      </div>
    </section>
  );
}

