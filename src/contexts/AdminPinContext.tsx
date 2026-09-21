import { createContext, useCallback, useContext, useMemo, useState, ReactNode } from "react";

/**
 * Where the PIN-locked sections remember they are open.
 *
 * In React state, and nowhere else. The gate used to keep its answer in
 * `sessionStorage['pin-ok:<section>']`, which meant the one thing standing between a
 * stranger and the payroll board was a value that stranger could write themselves:
 * `sessionStorage.setItem('pin-ok:workforce', '1')` in the console and the door was
 * open, with no PIN, no request and no trace. For a lock whose declared purpose is the
 * laptop left unattended in the office — where whoever sits down has the browser's own
 * devtools — a secret the browser is holding on their behalf is not a secret.
 *
 * What lives here dies with the page, and that is the whole property. It costs two
 * things, both of them on purpose:
 *
 *   - a refresh asks for the PIN again;
 *   - a second tab asks for the PIN again, where before it inherited the first.
 *
 * What it does not cost is moving between the five screens of a section, which is why
 * the provider sits above the routes in App.tsx and not inside any page. A PIN typed
 * four times an hour stops being a lock and becomes a habit somebody works around.
 *
 * THIS IS A LOCK ON THE SCREEN, NOT ON THE DATA. Attendance and Finance Close still
 * read `employees`, `attendance_days` and `overtime_entries` with the signed-in user's
 * own token, and RLS hands them over to any admin. Somebody willing to write the
 * PostgREST call by hand never sees this gate at all. Closing that is a different and
 * much larger piece of work — the PIN would have to sit in front of the rows, not in
 * front of the page.
 */

interface AdminPinContextValue {
  /** Whether `key` is currently open on this page. */
  isUnlocked: (key: string) => boolean;
  unlock: (key: string) => void;
  relock: (key: string) => void;
}

const AdminPinContext = createContext<AdminPinContextValue | null>(null);

export function AdminPinProvider({ children }: { children: ReactNode }) {
  const [abertas, setAbertas] = useState<Record<string, boolean>>({});

  const unlock = useCallback((key: string) => {
    setAbertas((s) => (s[key] ? s : { ...s, [key]: true }));
  }, []);

  const relock = useCallback((key: string) => {
    setAbertas((s) => {
      if (!s[key]) return s;
      const proximo = { ...s };
      delete proximo[key];
      return proximo;
    });
  }, []);

  const value = useMemo<AdminPinContextValue>(
    () => ({ isUnlocked: (key) => abertas[key] === true, unlock, relock }),
    [abertas, unlock, relock],
  );

  return <AdminPinContext.Provider value={value}>{children}</AdminPinContext.Provider>;
}

/**
 * Throws when there is no provider above it, rather than defaulting to locked.
 *
 * A missing provider would otherwise read as "every section is shut" — a gate nobody
 * can open, on five screens, discovered by whoever tries to do payroll that morning.
 * Failing at mount puts it in front of whoever moved the provider instead.
 */
export function useAdminPin(): AdminPinContextValue {
  const ctx = useContext(AdminPinContext);
  if (!ctx) throw new Error("useAdminPin precisa de um <AdminPinProvider> acima dele");
  return ctx;
}
