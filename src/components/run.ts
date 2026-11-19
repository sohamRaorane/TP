// Safe wrappers for UI handlers. A thrown or rejected action becomes a toast
// instead of crashing the React tree.
import { useCanvasStore } from '@/store/canvasStore';
import type { AppState } from '@/types/appState';

type ToastKind = NonNullable<AppState['toast']>['kind'];

export function toast(message: string, kind: ToastKind = 'info') {
  useCanvasStore.getState().setAppState({ toast: { message, kind } });
}

export function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : 'Something went wrong';
  const m = /^(\w+): implemented by/.exec(raw);
  if (m) return `"${m[1]}" isn't available yet`;
  return raw || 'Something went wrong';
}

function report(err: unknown) {
  console.error(err);
  toast(errorMessage(err), 'error');
}

/** Run a UI action; sync throws and async rejections become an error toast. */
export function run(fn: () => unknown, opts?: { success?: string }): void {
  try {
    const out = fn();
    if (out && typeof (out as Promise<unknown>).then === 'function') {
      (out as Promise<unknown>).then(
        () => opts?.success && toast(opts.success, 'success'),
        report,
      );
    } else if (opts?.success) {
      toast(opts.success, 'success');
    }
  } catch (err) {
    report(err);
  }
}

/** Await an action and return its result, or undefined after showing a toast. */
export async function runAsync<T>(fn: () => T | Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    report(err);
    return undefined;
  }
}

/** Patch UI-only app state (dialogs, toggles, theme). */
export const setUi = (p: Partial<AppState>) => useCanvasStore.getState().setAppState(p);
export const getApp = () => useCanvasStore.getState().appState;
