// Applies the theme class before first paint (loaded by index.html as a
// blocking script). "minder-theme" must stay in sync with lib/theme.ts's
// STORAGE_KEY. Kept out of index.html because the CSP forbids inline scripts.
(function () {
  try {
    var t = localStorage.getItem("minder-theme");
    var dark =
      t === "dark" ||
      ((!t || t === "system") &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (dark) document.documentElement.classList.add("dark");
  } catch (e) {
    /* localStorage unavailable (e.g. private-mode restrictions) -- fall
       through to the default light theme rather than breaking load. */
  }
})();
