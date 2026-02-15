import { browser } from "$app/environment";

let dark = $state(true);

export function isDark(): boolean {
  return dark;
}

export function initTheme(): void {
  if (browser) {
    dark = document.documentElement.getAttribute("data-theme") !== "light";
  }
}

export function toggleTheme(): void {
  dark = !dark;
  const theme = dark ? "dark" : "light";
  if (dark) {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", "light");
  }
  if (browser) {
    localStorage.setItem("weave-theme", theme);
  }
}
