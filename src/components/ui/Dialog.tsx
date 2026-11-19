import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { portalRoot } from './portal';

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

interface Props {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  /** element to focus first (selector inside the dialog) */
  initialFocus?: string;
  testId?: string;
  className?: string;
  /** hide the large title header (custom layouts like the command palette) */
  bare?: boolean;
  align?: 'center' | 'top';
}

/** Modal dialog: backdrop, Escape closes, focus trap, aria-modal. */
export function Dialog({ title, onClose, children, footer, width = 560, initialFocus, testId, className, bare, align = 'center' }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first =
      (initialFocus && el?.querySelector<HTMLElement>(initialFocus)) ||
      el?.querySelector<HTMLElement>('[data-autofocus]') ||
      el;
    first?.focus({ preventScroll: true });
    return () => prev?.focus?.({ preventScroll: true });
  }, [initialFocus]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      closeRef.current();
      return;
    }
    if (e.key !== 'Tab' || !ref.current) return;
    const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null);
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      className="sb-backdrop"
      style={align === 'top' ? { alignItems: 'flex-start', paddingTop: '12vh' } : undefined}
      onPointerDown={(e) => { if (e.target === e.currentTarget) closeRef.current(); }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid={testId}
        className={`sb-dialog ${className ?? ''}`}
        style={{ maxWidth: width }}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => e.stopPropagation()}
      >
        {bare ? (
          <h2 id={titleId} className="sr-only">{title}</h2>
        ) : (
          <div className="sb-dialog__header">
            <h2 id={titleId} className="sb-dialog__title">{title}</h2>
          </div>
        )}
        {!bare && (
          <button type="button" className="sb-tool sb-dialog__close" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        )}
        {children}
        {footer && <div className="sb-dialog__footer">{footer}</div>}
      </div>
    </div>,
    portalRoot(),
  );
}
