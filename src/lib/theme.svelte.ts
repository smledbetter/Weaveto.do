import { browser } from "$app/environment";

let dark = $state(false);

export function isDark(): boolean {
  return dark;
}

export function initTheme(): void {
  if (browser) {
    dark = document.documentElement.getAttribute("data-theme") === "dark";
  }
}

export function toggleTheme(): void {
  dark = !dark;
  const theme = dark ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", theme);
  if (browser) {
    localStorage.setItem("weave-theme", theme);
  }
}
