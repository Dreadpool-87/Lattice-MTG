(() => {
  const colors = ["white", "blue", "black", "red", "green"];
  const key = "lattice-color-theme";
  const root = document.documentElement;
  let savedTheme;

  try {
    savedTheme = localStorage.getItem(key);
  } catch {
    // The default theme works without storage.
  }
  root.dataset.theme = colors.includes(savedTheme) ? savedTheme : "green";

  document.addEventListener("DOMContentLoaded", () => {
    const header = document.querySelector(".sitebar .brandrow");
    if (!header) return;

    const theme = document.createElement("select");
    theme.className = "theme-select";
    theme.setAttribute("aria-label", "Color theme");
    for (const color of colors) {
      theme.add(new Option(color[0].toUpperCase() + color.slice(1), color));
    }
    theme.value = root.dataset.theme;
    theme.addEventListener("change", () => {
      root.dataset.theme = theme.value;
      try {
        localStorage.setItem(key, theme.value);
      } catch {
        // Keep applying the selection on this page.
      }
    });
    header.insertBefore(theme, header.querySelector(".admin-link"));
  });
})();
