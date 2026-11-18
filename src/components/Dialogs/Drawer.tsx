import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

/** Non-modal right-side drawer (library, version history). Escape closes. */
export function Drawer({ title, icon, onClose, children, testId, width = 360 }: { title: string; icon?: ReactNode; onClose: () => void; children: ReactNode; testId?: string; width?: number }) {
  const ref = useRef<HTMLElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);

  return (
    <aside
      ref={ref}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      tabIndex={-1}
      className="sb-drawer sb-pe"
      style={{ width, outline: 'none' }}
      data-testid={testId}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); }
      }}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <header className="flex items-center gap-2" style={{ padding: '14px 12px 12px 16px' }}>
        <span style={{ color: 'var(--color-primary)', display: 'inline-flex' }}>{icon}</span>
        <h2 id={titleId} className="flex-1" style={{ margin: 0, font: '700 16px var(--ui-font)' }}>{title}</h2>
        <button type="button" className="sb-tool" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      {children}
    </aside>
  );
}
