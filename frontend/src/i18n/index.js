import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { LOCALES } from "./locales";

export const SUPPORTED = ["en", "pt-br"];
export const FALLBACK = "en";

export const LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "pt-br", label: "Português (Brasil)" },
];

// EN e o idioma padrao do sistema e o fallback de toda traducao. Sem login, o
// idioma vem do navegador; qualquer coisa nao suportada cai para EN.
export function normalize(lang) {
  const value = (lang || "").trim().toLowerCase().replace("_", "-");
  if (SUPPORTED.includes(value)) return value;
  const base = value.split("-")[0];
  if (base === "pt") return "pt-br";
  if (base === "en") return "en";
  return null;
}

export function detectBrowserLanguage() {
  const candidates =
    navigator.languages && navigator.languages.length
      ? navigator.languages
      : [navigator.language];
  for (const c of candidates) {
    const n = normalize(c);
    if (n) return n;
  }
  return FALLBACK;
}

const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const [lang, setLang] = useState(detectBrowserLanguage);

  // Adota um idioma (o escolhido no seletor do cabecalho, por exemplo).
  const setLanguage = useCallback((value) => {
    setLang(normalize(value) || FALLBACK);
  }, []);

  // Volta ao idioma detectado no navegador.
  const resetLanguage = useCallback(() => {
    setLang(detectBrowserLanguage());
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("lang", lang);
  }, [lang]);

  const t = useCallback(
    (key, fallbackText) => {
      const table = LOCALES[lang] || LOCALES[FALLBACK];
      return table[key] ?? LOCALES[FALLBACK][key] ?? fallbackText ?? key;
    },
    [lang]
  );

  // Interpolação simples: t("x.y", "…") com {placeholders}.
  const tf = useCallback(
    (key, params = {}, fallbackText) => {
      const text = t(key, fallbackText);
      return Object.keys(params).reduce(
        (acc, k) => acc.replaceAll(`{${k}}`, params[k]),
        text
      );
    },
    [t]
  );

  return (
    <I18nContext.Provider value={{ lang, setLanguage, resetLanguage, t, tf }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
