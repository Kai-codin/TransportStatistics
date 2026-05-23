"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type ThemeKey = "bright" | "light" | "dark";

const THEME_STORAGE_KEY = "transportstatistics-theme";

const ThemeContext = createContext<{
  theme: ThemeKey;
  setTheme: (theme: ThemeKey) => void;
} | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeKey>(() => {
    if (typeof window === "undefined") {
      return "dark";
    }

    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    return storedTheme === "bright" || storedTheme === "light" || storedTheme === "dark"
      ? storedTheme
      : "dark";
  });

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.tsTheme = theme;
    root.style.colorScheme = theme === "dark" ? "dark" : "light";
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }

  return context;
}