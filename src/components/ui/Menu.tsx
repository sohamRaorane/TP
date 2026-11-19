import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';

/** Keyboard-navigable menu container (role=menu, arrow keys, Home/End). */
export function Menu({ children, label, className, autoFocus = true }: { children: ReactNode; label: string; className?: string; autoFocus?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
  }, [autoFocus]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []);
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = (i + 1) % items.length;
    else if (e.key === 'ArrowUp') next = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next >= 0) {
      e.preventDefault();
      e.stopPropagation();
      items[next].focus();
    }
  };

  return (
    <div ref={ref} role="menu" aria-label={label} className={`sb-menu ${className ?? ''}`} onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}

interface ItemProps {
  icon?: ReactNode;
  label: ReactNode;
  shortcut?: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  testId?: string;
}

export function MenuItem({ icon, label, shortcut, onSelect, danger, disabled, testId }: ItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      disabled={disabled}
      data-testid={testId}
      className={`sb-menu-item ${danger ? 'sb-menu-item--danger' : ''}`}
      onClick={onSelect}
    >
      {icon !== undefined && <span className="sb-menu-item__icon">{icon}</span>}
      <span className="sb-menu-item__label">{label}</span>
      {shortcut && <span className="sb-menu-item__shortcut">{shortcut}</span>}
    </button>
  );
}

export const MenuSeparator = () => <hr className="sb-menu-sep" />;
