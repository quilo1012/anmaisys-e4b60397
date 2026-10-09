import { useSignupQr } from "@/hooks/useSignupQr";

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
 * Creating an account there would make it permanent — `link_me_to_employee` binds the
 * login to one employee and refuses to do it twice. So this screen does not offer it:
 * `showCreateAccount` is already false on a tablet, and this is what belongs in its
 * place. The phone in somebody's pocket is the only device in this building that is
 * reliably one person.
 *
 * The code carries the signup URL and nothing else — see `signupQrPayload`, which has
 * a test naming what it may carry and what it never will. Scanning grants nothing.
 */
export function SignupQrCard({ origin, tone = "auth" }: { origin?: string; tone?: "auth" | "page" }) {
  const base = origin ?? (typeof window !== "undefined" ? window.location.origin : "");
  // No code here, and there is none to give: `signup_config` is unreadable without an
  // admin session, which is what keeps the factory's code off a public login page.
  const { src, failed } = useSignupQr(base);

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
        Register on your phone, not on this tablet — the account has to be yours.
      </p>
    </div>
  );
}
