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
    document.documentElement.lang = language;
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
