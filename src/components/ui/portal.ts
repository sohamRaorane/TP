/** Portal target inside the app root so theme CSS variables (.dark) apply. */
export const PORTAL_ID = 'sb-portal';
export const portalRoot = (): HTMLElement =>
  document.getElementById(PORTAL_ID) ?? document.querySelector<HTMLElement>('.sb-root') ?? document.body;

/** Clamp a floating box (fixed coords) into the viewport. */
export function clampToViewport(x: number, y: number, w: number, h: number, margin = 8) {
  return {
    x: Math.max(margin, Math.min(x, window.innerWidth - w - margin)),
    y: Math.max(margin, Math.min(y, window.innerHeight - h - margin)),
  };
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
/** Format a shortcut like "Ctrl+Shift+Z" for the current platform. */
export const kbd = (s: string) =>
  isMac ? s.replace(/Ctrl\+/g, '⌘').replace(/Shift\+/g, '⇧').replace(/Alt\+/g, '⌥') : s;
