// Client-side login rate limiter with exponential lockout.
// Persisted in localStorage so it survives page refreshes. Keyed per identity
// (email for staff, account_id for tablet) so one user's failures can't lock
// out a different account on the same browser.
//
// NOTE: this is a defense-in-depth measure against manual/scripted abuse only.
// Real protection lives server-side (Supabase Auth per-IP limits).

const KEY_PREFIX = "an_login_rl:";
const MAX_FREE_ATTEMPTS = 5;
const LOCKOUT_LADDER_MS = [30_000, 60_000, 120_000, 300_000];

type State = {
  failures: number;     // consecutive failed attempts since last success
  lockouts: number;     // number of lockouts triggered (caps at ladder length)
  lockedUntil: number;  // epoch ms; 0 if not locked
};

function load(id: string): State {
  if (typeof window === "undefined") return { failures: 0, lockouts: 0, lockedUntil: 0 };
  try {
    const raw = window.localStorage.getItem(KEY_PREFIX + id);
    if (!raw) return { failures: 0, lockouts: 0, lockedUntil: 0 };
    const v = JSON.parse(raw);
    return {
      failures: Number(v.failures) || 0,
      lockouts: Number(v.lockouts) || 0,
      lockedUntil: Number(v.lockedUntil) || 0,
    };
  } catch {
    return { failures: 0, lockouts: 0, lockedUntil: 0 };
  }
}

function save(id: string, s: State) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY_PREFIX + id, JSON.stringify(s));
  } catch {
    // localStorage may be full or disabled — silent.
  }
}

export function getLoginLockout(id: string): { lockedMsLeft: number; remaining: number } {
  if (!id) return { lockedMsLeft: 0, remaining: MAX_FREE_ATTEMPTS };
  const s = load(id);
  const lockedMsLeft = Math.max(0, s.lockedUntil - Date.now());
  const remaining = Math.max(0, MAX_FREE_ATTEMPTS - s.failures);
  return { lockedMsLeft, remaining };
}

export function recordLoginFailure(id: string): { lockedMsLeft: number; remaining: number } {
  if (!id) return { lockedMsLeft: 0, remaining: MAX_FREE_ATTEMPTS };
  const s = load(id);
  s.failures += 1;
  if (s.failures >= MAX_FREE_ATTEMPTS) {
    const step = Math.min(s.lockouts, LOCKOUT_LADDER_MS.length - 1);
    s.lockedUntil = Date.now() + LOCKOUT_LADDER_MS[step];
    s.lockouts += 1;
    s.failures = 0;
  }
  save(id, s);
  return {
    lockedMsLeft: Math.max(0, s.lockedUntil - Date.now()),
    remaining: Math.max(0, MAX_FREE_ATTEMPTS - s.failures),
  };
}

export function clearLoginLockout(id: string) {
  if (!id || typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY_PREFIX + id);
  } catch {
    // silent
  }
}
