import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';
import { App } from './App';

// Load the hand-drawn font before the first render so text measurement and
// canvas rendering never use fallback metrics (bounded so a slow network can't block startup).
async function preloadFonts() {
  if (typeof document === 'undefined' || !document.fonts?.load) return;
  const timeout = new Promise((r) => setTimeout(r, 1500));
  await Promise.race([Promise.all([document.fonts.load('20px Kalam'), document.fonts.load('400 20px Kalam')]).catch(() => undefined), timeout]);
}

void preloadFonts().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
