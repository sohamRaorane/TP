import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Tooltip, type Side } from './Tooltip';

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  label: string;
  shortcut?: string;
  icon: ReactNode;
  active?: boolean;
  /** small key hint in the bottom-right corner */
  keyHint?: string;
  side?: Side;
  tooltip?: boolean;
}

/** 36x36 icon button with custom tooltip and aria-label (toolbar / islands). */
export const IconButton = forwardRef<HTMLButtonElement, Props>(function IconButton(
  { label, shortcut, icon, active, keyHint, side = 'bottom', tooltip = true, className, ...rest },
  ref,
) {
  const btn = (
    <button
      ref={ref}
      type="button"
      aria-label={shortcut ? `${label} (${shortcut})` : label}
      className={`sb-tool ${active ? 'is-active' : ''} ${className ?? ''}`}
      {...rest}
    >
      {icon}
      {keyHint && <span className="sb-tool__kbd" aria-hidden>{keyHint}</span>}
    </button>
  );
  return tooltip ? <Tooltip label={label} shortcut={shortcut} side={side}>{btn}</Tooltip> : btn;
});
