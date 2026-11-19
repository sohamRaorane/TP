import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { portalRoot } from './portal';

export type Side = 'top' | 'bottom' | 'left' | 'right';

interface Props {
  label: ReactNode;
  shortcut?: string;
  side?: Side;
  children: ReactNode;
  className?: string;
  /** disable the tooltip (e.g. while a popover is open) */
  disabled?: boolean;
}

const GAP = 8;

/** Hover/focus tooltip rendered in a portal (dark chip, like Excalidraw). */
export function Tooltip({ label, shortcut, side = 'bottom', children, className, disabled }: Props) {
  const wrap = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const show = useCallback((delay: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), delay);
  }, []);
  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    setOpen(false);
    setPos(null);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    if (!open || !wrap.current || !tip.current) return;
    const a = wrap.current.getBoundingClientRect();
    const t = tip.current.getBoundingClientRect();
    let left = 0;
    let top = 0;
    if (side === 'right') { left = a.right + GAP; top = a.top + a.height / 2 - t.height / 2; }
    if (side === 'left') { left = a.left - GAP - t.width; top = a.top + a.height / 2 - t.height / 2; }
    if (side === 'bottom') { left = a.left + a.width / 2 - t.width / 2; top = a.bottom + GAP; }
    if (side === 'top') { left = a.left + a.width / 2 - t.width / 2; top = a.top - GAP - t.height; }
    left = Math.max(6, Math.min(left, window.innerWidth - t.width - 6));
    top = Math.max(6, Math.min(top, window.innerHeight - t.height - 6));
    setPos({ left, top });
  }, [open, side]);

  return (
    <span
      ref={wrap}
      className={className ?? 'inline-flex'}
      onPointerEnter={(e) => e.pointerType === 'mouse' && show(350)}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocus={(e) => (e.target as HTMLElement).matches(':focus-visible') && show(0)}
      onBlur={hide}
    >
      {children}
      {open && !disabled &&
        createPortal(
          <div
            ref={tip}
            role="tooltip"
            className="sb-tooltip"
            style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
          >
            {label}
            {shortcut && <span className="sb-tooltip__kbd">— {shortcut}</span>}
          </div>,
          portalRoot(),
        )}
    </span>
  );
}
