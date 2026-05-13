import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export const TABLE_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

const STORAGE_KEY = "erp_settings_v1";

/** @typedef {'light' | 'dark'} Theme */
/** @typedef {'fr' | 'ar' | 'en'} UiLanguage */
/** @typedef {'fr' | 'iso' | 'long'} DateDisplayFormat */

const DEFAULTS = {
  itemsPerPage: 20,
  theme: /** @type {Theme} */ ("light"),
  uiLanguage: /** @type {UiLanguage} */ ("fr"),
  dateFormat: /** @type {DateDisplayFormat} */ ("fr"),
};

function normalizeItemsPerPage(value) {
  const n = Number(value);
  return TABLE_PAGE_SIZE_OPTIONS.includes(n) ? n : DEFAULTS.itemsPerPage;
}

function normalizeTheme(value) {
  return value === "dark" ? "dark" : "light";
}

function normalizeUiLanguage(value) {
  return ["fr", "ar", "en"].includes(value) ? value : DEFAULTS.uiLanguage;
}

function normalizeDateFormat(value) {
  return ["fr", "iso", "long"].includes(value) ? value : DEFAULTS.dateFormat;
}

function readInitialState() {
  if (typeof window === "undefined") {
    return { ...DEFAULTS };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const data = JSON.parse(raw);
    return {
      itemsPerPage: normalizeItemsPerPage(data?.itemsPerPage),
      theme: normalizeTheme(data?.theme),
      uiLanguage: normalizeUiLanguage(data?.uiLanguage),
      dateFormat: normalizeDateFormat(data?.dateFormat),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function persistState(partial) {
  try {
    const prev = readInitialState();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...prev, ...partial }));
  } catch {
    /* quota / mode privé */
  }
}

const SettingsContext = createContext(null);

export function SettingsProvider({ children }) {
  const initial = readInitialState();
  const [itemsPerPage, setItemsPerPageState] = useState(initial.itemsPerPage);
  const [theme, setThemeState] = useState(initial.theme);
  const [uiLanguage, setUiLanguageState] = useState(initial.uiLanguage);
  const [dateFormat, setDateFormatState] = useState(initial.dateFormat);

  /** @param {(prev: Theme) => Theme | Theme} next */
  const setTheme = useCallback((next) => {
    setThemeState((prev) => {
      const resolved = normalizeTheme(typeof next === "function" ? next(prev) : next);
      persistState({ theme: resolved });
      return resolved;
    });
  }, []);

  /** @param {(prev: UiLanguage) => UiLanguage | UiLanguage} next */
  const setUiLanguage = useCallback((next) => {
    setUiLanguageState((prev) => {
      const resolved = normalizeUiLanguage(typeof next === "function" ? next(prev) : next);
      persistState({ uiLanguage: resolved });
      return resolved;
    });
  }, []);

  /** @param {(prev: DateDisplayFormat) => DateDisplayFormat | DateDisplayFormat} next */
  const setDateFormat = useCallback((next) => {
    setDateFormatState((prev) => {
      const resolved = normalizeDateFormat(typeof next === "function" ? next(prev) : next);
      persistState({ dateFormat: resolved });
      return resolved;
    });
  }, []);

  const setItemsPerPage = useCallback((next) => {
    setItemsPerPageState((prev) => {
      const n = normalizeItemsPerPage(typeof next === "function" ? next(prev) : next);
      persistState({ itemsPerPage: n });
      return n;
    });
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const langMap = { fr: "fr-TN", ar: "ar", en: "en" };
    document.documentElement.lang = langMap[uiLanguage] ?? "fr-TN";
  }, [uiLanguage]);

  const value = useMemo(
    () => ({
      itemsPerPage,
      setItemsPerPage,
      theme,
      setTheme,
      uiLanguage,
      setUiLanguage,
      dateFormat,
      setDateFormat,
    }),
    [itemsPerPage, setItemsPerPage, theme, setTheme, uiLanguage, setUiLanguage, dateFormat, setDateFormat],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return ctx;
}
