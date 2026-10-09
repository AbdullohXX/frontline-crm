"use client";
import { useEffect, useId, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
type Theme = "light" | "dark" | "system";
const valid = (value: unknown): Theme =>
  value === "light" || value === "dark" ? value : "system";
function applyTheme(preference: Theme) {
  const root = document.documentElement;
  root.dataset.themePreference = preference;
  root.dataset.theme =
    preference === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : preference;
}
export default function ThemeSwitcher() {
  const [theme, setTheme] = useState<Theme>("system");
  const id = useId();
  useEffect(() => {
    let initial: Theme = "system";
    try {
      initial = valid(localStorage.getItem("frontline-theme"));
    } catch {}
    setTheme(initial);
    applyTheme(initial);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystem = () => {
      if (document.documentElement.dataset.themePreference === "system")
        applyTheme("system");
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== "frontline-theme" && event.key !== null) return;
      const preference = valid(event.newValue);
      setTheme(preference);
      applyTheme(preference);
    };
    media.addEventListener("change", onSystem);
    window.addEventListener("storage", onStorage);
    return () => {
      media.removeEventListener("change", onSystem);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  const Icon = theme === "system" ? Monitor : theme === "light" ? Sun : Moon;
  return (
    <label className="theme-switcher" htmlFor={id}>
      <Icon size={15} aria-hidden="true" />
      <select
        id={id}
        aria-label="Appearance"
        value={theme}
        onChange={(event) => {
          const preference = valid(event.target.value);
          setTheme(preference);
          applyTheme(preference);
          try {
            localStorage.setItem("frontline-theme", preference);
          } catch {}
        }}
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}
