import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { clampToViewport, portalRoot } from './portal';

interface Props {
  anchor: HTMLElement | null;
  onClose: () => void;
  side?: 'right' | 'left' | 'bottom' | 'top';
  align?: 'start' | 'end' | 'center';
  offset?: number;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  role?: string;
  label?: string;
}

/** Floating panel anchored to an element; closes on outside click and Escape. */
export function Popover({ anchor, onClose, side = 'bottom', align = 'start', offset = 8, className, style, children, role = 'dialog', label }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    const place = () => {
      if (!anchor || !ref.current) return;
      const a = anchor.getBoundingClientRect();
      const p = ref.current.getBoundingClientRect();
      let x = 0;
      let y = 0;
      if (side === 'bottom' || side === 'top') {
        x = align === 'start' ? a.left : align === 'end' ? a.right - p.width : a.left + a.width / 2 - p.width / 2;
        y = side === 'bottom' ? a.bottom + offset : a.top - offset - p.height;
      } else {
        y = align === 'start' ? a.top : align === 'end' ? a.bottom - p.height : a.top + a.height / 2 - p.height / 2;
        x = side === 'right' ? a.right + offset : a.left - offset - p.width;
      }
      setPos(clampToViewport(x, y, p.width, p.height));
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor, side, align, offset]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor?.contains(t)) return;
      closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
        anchor?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [anchor]);

  return createPortal(
    <div
      ref={ref}
      role={role}
      aria-label={label}
      className={`sb-popover ${className ?? ''}`}
      style={{ left: pos?.x ?? -9999, top: pos?.y ?? -9999, ...style }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </div>,
    portalRoot(),
  );
}
