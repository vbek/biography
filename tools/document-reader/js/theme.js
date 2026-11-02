/* Runs before first paint: the theme is shared with the rest of the portfolio. */
(function () {
  try {
    if (localStorage.getItem('theme') !== 'dark') document.documentElement.setAttribute('data-theme', 'light');
  } catch (e) { document.documentElement.setAttribute('data-theme', 'light'); }
})();
