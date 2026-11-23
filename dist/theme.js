(() => {
  const themes = {
    white: ["White", "#f4dcab", "m12 8 4 4-4 4-4-4zM12 4v1m0 14v1M4 12h1m14 0h1M6 6l1 1m10 10 1 1M6 18l1-1M17 7l1-1"],
    blue: ["Blue", "#a9d9fa", "M12 4c-2 3-5 6-5 10a5 5 0 0 0 10 0c0-4-3-7-5-10zM8 14c2-2 4 2 8 0"],
    black: ["Black", "#dac5dd", "M8 5h8l3 4v6l-3 2v2H8v-2l-3-2V9zM8 11h2m4 0h2m-6 8v-3m4 3v-3"],
    red: ["Red", "#ffba9e", "m12 4 5 7 1-2 1 6-3 4H9l-4-4 3-5 1 3zM10 19l-1-3 3-3 2 3-1 3"],
    green: ["Green", "#b1e1b6", "M12 20v-3m-3 3h6M12 4l4 5h-2l4 4h-3l3 4H6l3-4H6l4-4H8z"],
    wubrg: ["WUBRG"],
  };
  const sequence = ["white", "blue", "black", "red", "green"];
  const key = "lattice-color-theme";
  const unlockKey = "lattice-wubrg-unlocked";
  const root = document.documentElement;
  let savedTheme;
  let unlocked = false;

  try {
    savedTheme = localStorage.getItem(key);
    unlocked = localStorage.getItem(unlockKey) === "true";
  } catch {
    // The default theme works without storage.
  }
  root.dataset.theme = Object.hasOwn(themes, savedTheme) && (savedTheme !== "wubrg" || unlocked)
    ? savedTheme
    : "green";

  function icon(color) {
    if (color === "wubrg") return '<span class="wubrg-swatch" aria-hidden="true"></span>';
    const [, fill, lines] = themes[color];
    return `<svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24">
      <rect x="1" y="1" width="22" height="22" rx="7" fill="${fill}"/>
      <path d="${lines}" fill="none" stroke="#202025" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }

  document.addEventListener("DOMContentLoaded", () => {
    const header = document.querySelector(".sitebar .brandrow");
    if (!header) return;

    const picker = document.createElement("details");
    picker.className = "theme-picker";
    const trigger = document.createElement("summary");
    const options = document.createElement("div");
    options.className = "theme-options";
    options.setAttribute("role", "group");
    options.setAttribute("aria-label", "Color theme");
    const buttons = new Map();
    let nextColor = 0;

    function showSelection(color) {
      const [label] = themes[color];
      trigger.innerHTML = icon(color);
      trigger.setAttribute("aria-label", `Color theme: ${label}`);
      trigger.title = `Color theme: ${label}`;
      for (const [value, button] of buttons) {
        button.setAttribute("aria-pressed", String(value === color));
      }
    }

    function closePicker() {
      picker.open = false;
      trigger.focus();
    }

    for (const [color, [label]] of Object.entries(themes)) {
      const button = document.createElement("button");
      button.type = "button";
      button.title = label;
      button.setAttribute("aria-label", label);
      button.innerHTML = icon(color);
      button.hidden = color === "wubrg" && !unlocked;
      button.addEventListener("click", () => {
        root.dataset.theme = color;
        showSelection(color);
        if (!unlocked) {
          nextColor = color === sequence[nextColor] ? nextColor + 1 : Number(color === sequence[0]);
          if (nextColor === sequence.length) {
            unlocked = true;
            const reward = buttons.get("wubrg");
            reward.hidden = false;
            reward.focus();
            try {
              localStorage.setItem(unlockKey, "true");
            } catch {
              // The unlocked theme remains available on this page.
            }
          } else if (nextColor === 0) {
            closePicker();
          }
        } else {
          closePicker();
        }
        try {
          localStorage.setItem(key, color);
        } catch {
          // Keep applying the selection on this page.
        }
      });
      options.append(button);
      buttons.set(color, button);
    }

    picker.addEventListener("keydown", event => {
      if (event.key !== "Escape" || !picker.open) return;
      event.preventDefault();
      closePicker();
    });
    document.addEventListener("click", event => {
      if (picker.open && !picker.contains(event.target)) picker.open = false;
    });
    showSelection(root.dataset.theme);
    picker.append(trigger, options);
    header.insertBefore(picker, header.querySelector(".admin-link"));
  });
})();
