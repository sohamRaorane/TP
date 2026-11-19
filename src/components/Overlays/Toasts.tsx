import { useEffect } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useCanvasStore } from '@/store/canvasStore';
import { setUi } from '../run';

/** appState.toast at bottom-center; auto-dismisses after 3s (errors 5s). */
export function Toasts() {
  const toast = useCanvasStore((s) => s.appState.toast);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => {
      if (useCanvasStore.getState().appState.toast === toast) setUi({ toast: null });
    }, toast.kind === 'error' ? 5000 : 3000);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast) return null;
  const Icon = toast.kind === 'error' ? AlertCircle : toast.kind === 'success' ? CheckCircle2 : Info;
  const color = toast.kind === 'error' ? 'var(--color-danger-strong)' : toast.kind === 'success' ? 'var(--color-success)' : 'var(--color-primary)';
  return (
    <div className="absolute flex justify-center" style={{ left: '50%', bottom: 72, transform: 'translateX(-50%)', zIndex: 70 }}>
      <div className={`sb-toast sb-toast--${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'} aria-live="polite" data-testid="toast">
        <Icon size={18} style={{ color, flex: '0 0 auto' }} />
        <span>{toast.message}</span>
        <button type="button" className="sb-tool" style={{ width: 24, height: 24 }} aria-label="Dismiss" onClick={() => setUi({ toast: null })}>
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
