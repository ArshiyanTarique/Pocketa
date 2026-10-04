import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

// A new deploy installs a new service worker, which takes control straight away
// (autoUpdate). Without a reload the page keeps running the old bundle until
// the next visit, so a fresh build — new fonts, new screens — looks missing.
// Reload once when control changes; skip the very first install.
if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
