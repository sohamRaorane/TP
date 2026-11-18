// Promise-based confirm dialog (UI-local state, not part of the scene store).
import { create } from 'zustand';
import { Dialog } from './Dialog';

interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

const useConfirmStore = create<{ req: ConfirmRequest | null }>(() => ({ req: null }));

export function confirmDialog(opts: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirmStore.getState().req?.resolve(false);
    useConfirmStore.setState({ req: { ...opts, resolve } });
  });
}

export function ConfirmHost() {
  const req = useConfirmStore((s) => s.req);
  if (!req) return null;
  const done = (ok: boolean) => {
    useConfirmStore.setState({ req: null });
    req.resolve(ok);
  };
  return (
    <Dialog
      title={req.title}
      onClose={() => done(false)}
      width={440}
      testId="confirm-dialog"
      initialFocus="[data-confirm]"
      footer={
        <>
          <button type="button" className="sb-btn sb-btn--outline" onClick={() => done(false)}>Cancel</button>
          <button
            type="button"
            data-confirm
            className={`sb-btn ${req.danger ? 'sb-btn--danger' : 'sb-btn--primary'}`}
            onClick={() => done(true)}
          >
            {req.confirmLabel ?? 'Confirm'}
          </button>
        </>
      }
    >
      <div className="sb-dialog__body" style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--color-muted)' }}>{req.message}</div>
    </Dialog>
  );
}
