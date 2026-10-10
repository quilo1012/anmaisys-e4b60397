import { Link } from "react-router-dom";
import { useSignupQr } from "@/hooks/useSignupQr";
import { tabletSignupPath } from "@/lib/signupQr";

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
   * placed. See `useTabletInviteCode` for who is allowed to supply one.
   */
  inviteCode,
}: { origin?: string; tone?: "auth" | "page"; inviteCode?: string | null }) {
  const base = origin ?? (typeof window !== "undefined" ? window.location.origin : "");
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

  return (
    <div className="mt-6 flex flex-col items-center gap-2">
      <p className={`text-sm ${muted}`}>New here? Scan this with your own phone.</p>
      {src
        ? <img src={src} alt="QR code to the registration page" className="h-36 w-36 rounded bg-white p-1.5" />
        : <div className={`h-36 w-36 animate-pulse rounded ${placeholder}`} aria-hidden />}
      <p className={`max-w-[16rem] text-center text-xs ${muted}`}>
        Or create it here — the tablet stays signed in as the line, not as you.
      </p>
      <Link
        to={tabletSignupPath(inviteCode)}
        className={tone === "auth"
          ? "inline-flex h-10 items-center justify-center rounded-lg bg-auth-brand px-5 text-sm font-semibold text-white shadow-sm hover:bg-auth-brand/90"
          : "inline-flex h-10 items-center justify-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"}
      >
        Create account
      </Link>
      {/* What the scan gets you, said before the scan rather than after.
          Without the code the form opens with a box labelled "From your supervisor",
          and somebody who walked away from the tablet to fill it in has no way back
          to find out where it comes from. */}
      <p className={`max-w-[16rem] text-center text-xs ${muted}`}>
        {carriesCode
          ? "The invite code is already in this square and in the button — you won't be asked for it."
          : "You'll need the invite code from the sign-up sheet where you clock in."}
      </p>
    </div>
  );
}

