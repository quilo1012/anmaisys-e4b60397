import { createContext, useContext, useEffect, useState, ReactNode } from "react";

export type Language = "en" | "pt";

interface LanguageContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  toggle: () => void;
}

const STORAGE_KEY = "app.language";

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

function readInitial(): Language {
  if (typeof window === "undefined") return "en";
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "pt" || stored === "en" ? stored : "en";
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(readInitial);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, language);
    /**
     * `lang` is pinned to "en", not to `language`.
     *
     * This context translates nothing — there is no dictionary and no `t()`, and the
     * one toggle that used to set it was removed from the header ("app stays in
     * English"). What was left behind was a trap: anyone who had ever switched to
     * Portuguese still had `"pt"` in localStorage, so this line kept writing
     * `<html lang="pt">` over an English interface, with no way left to change it
     * back. A screen reader then read English words with Portuguese phonetics,
     * permanently.
     *
     * The preference is still stored, so nothing is lost if real translations ever
     * arrive — but `lang` must describe the language actually on screen.
     */
    document.documentElement.lang = "en";
  }, [language]);

  const setLanguage = (lang: Language) => setLanguageState(lang);
  const toggle = () => setLanguageState((l) => (l === "en" ? "pt" : "en"));

  return (
    <LanguageContext.Provider value={{ language, setLanguage, toggle }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within LanguageProvider");
  return ctx;
}
