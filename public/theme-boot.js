// Apply the saved theme before first paint so the app never flashes light.
// A file rather than an inline script: the Content-Security-Policy only allows
// scripts served from this origin.
try {
  var t = localStorage.getItem('pocketa.theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch (e) {
  /* private mode — fall through to system preference */
}
