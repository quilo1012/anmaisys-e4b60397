import { createContext, useContext } from "react";

/**
 * The title the shell's top bar is showing for this route (routeTitles), so a page
 * header further down can tell when it is about to say the same words again.
 * Empty outside DashboardLayout — nothing is hidden there.
 */
export const ShellTitleContext = createContext<string>("");

export function useShellTitle() {
  return useContext(ShellTitleContext);
}

/** Same screen name, give or take case and a trailing "Dashboard". */
export function sameTitle(a: string, b: string) {
  const norm = (t: string) => t.trim().toLowerCase().replace(/\s+dashboard$/, "");
  return !!a && !!b && norm(a) === norm(b);
}

/**
 * True inside DashboardLayout's content area. The shell's top bar already carries
 * Back on every screen, so a page that also drew its own BackButton — eight of them
 * did — spent a whole row on a second arrow. BackButton reads this and stays out.
 */
export const InShellContentContext = createContext<boolean>(false);
