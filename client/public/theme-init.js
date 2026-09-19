// Sets the theme before the first paint so there is no flash of the wrong one.
// 'system' leaves data-theme unset and lets the prefers-color-scheme rules in tokens.css decide.
(function () {
  try {
    var t = localStorage.getItem('waypoint-theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
})();
