// Global keyboard shortcuts + native clipboard events. Mounted once by App.
// Space (pan) is handled by the Canvas (A) and is not touched here.
import { useEffect } from 'react';
import { handleKeyDown } from './keyboard';
import { installClipboardListeners } from '@/services/clipboard';
import { actions, serializeSelection } from '@/services/actions';

export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const ctx = { pointerDown: false };
    const onKey = (e: KeyboardEvent) => {
      handleKeyDown(e, ctx);
    };
    const onDown = () => {
      ctx.pointerDown = true;
    };
    const onUp = () => {
      ctx.pointerDown = false;
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    window.addEventListener('blur', onUp);
    const removeClipboard = installClipboardListeners({
      serializeSelection,
      deleteSelection: () => actions.deleteSelected(),
      paste: (content) => actions.pasteContent(content),
    });
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      window.removeEventListener('blur', onUp);
      removeClipboard();
    };
  }, []);
}
