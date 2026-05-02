// Theme toggle module.
// Depends on: elements.themeToggleBtn (defined in app.js).

const THEME_KEY = "ops_platform_theme";

function currentTheme() {
  const attr = document.documentElement.dataset.theme;
  return attr === "light" ? "light" : "dark";
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
  try { localStorage.setItem(THEME_KEY, document.documentElement.dataset.theme); } catch (_) {}
  syncThemeIcon();
}

function syncThemeIcon() {
  const btn = elements.themeToggleBtn;
  if (!btn) return;
  const theme = currentTheme();
  btn.title = theme === "light" ? "Switch to dark theme" : "Switch to light theme";
  btn.querySelectorAll("[data-theme-icon]").forEach((icon) => {
    const want = theme === "light" ? "light" : "dark";
    icon.style.display = icon.dataset.themeIcon === want ? "" : "none";
  });
}

function toggleTheme() {
  applyTheme(currentTheme() === "light" ? "dark" : "light");
}
