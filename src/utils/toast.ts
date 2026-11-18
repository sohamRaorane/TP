import { useCanvasStore } from '@/store/canvasStore';
import { errorMessage } from './errors';

type ToastKind = 'info' | 'error' | 'success';

let timer: ReturnType<typeof setTimeout> | null = null;

/** show a toast in appState (UI renders it); auto-clears after `ms` */
export function toast(message: string, kind: ToastKind = 'info', ms = kind === 'error' ? 6000 : 3000): void {
  useCanvasStore.getState().setAppState({ toast: { message, kind } });
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    const cur = useCanvasStore.getState().appState.toast;
    if (cur && cur.message === message) useCanvasStore.getState().setAppState({ toast: null });
  }, ms);
}

export const toastError = (e: unknown, prefix?: string) =>
  toast(prefix ? `${prefix}: ${errorMessage(e)}` : errorMessage(e), 'error');
