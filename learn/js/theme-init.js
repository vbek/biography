// Runs before first paint so the page never flashes the wrong theme. Same rule as the rest of the site:
// light unless the visitor picked dark.
(function () {
    try {
        if (localStorage.getItem('theme') !== 'dark') document.documentElement.setAttribute('data-theme', 'light');
    } catch (e) { document.documentElement.setAttribute('data-theme', 'light'); }
})();
