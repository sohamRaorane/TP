import { useRef, useState } from 'react';
import { Popover } from '../ui/Popover';
import { Tooltip } from '../ui/Tooltip';
import { useIsNarrow } from '../ui/useMedia';

// Open Color based palette (same hues/shades Excalidraw uses).
export const PALETTE: Record<string, string[]> = {
  gray: ['#f8f9fa', '#e9ecef', '#ced4da', '#868e96', '#343a40'],
  bronze: ['#f8f1ee', '#eaddd7', '#d2bab0', '#a18072', '#846358'],
  red: ['#fff5f5', '#ffc9c9', '#ff8787', '#fa5252', '#e03131'],
  pink: ['#fff0f6', '#fcc2d7', '#f783ac', '#e64980', '#c2255c'],
  grape: ['#f8f0fc', '#eebefa', '#da77f2', '#be4bdb', '#9c36b5'],
  violet: ['#f3f0ff', '#d0bfff', '#9775fa', '#7950f2', '#6741d9'],
  blue: ['#e7f5ff', '#a5d8ff', '#4dabf7', '#228be6', '#1971c2'],
  cyan: ['#e3fafc', '#99e9f2', '#3bc9db', '#15aabf', '#0c8599'],
  teal: ['#e6fcf5', '#96f2d7', '#38d9a9', '#12b886', '#099268'],
  green: ['#ebfbee', '#b2f2bb', '#69db7c', '#40c057', '#2f9e44'],
  yellow: ['#fff9db', '#ffec99', '#ffd43b', '#fab005', '#f08c00'],
  orange: ['#fff4e6', '#ffd8a8', '#ffa94d', '#fd7e14', '#e8590c'],
};
export const STROKE_QUICK = ['#1e1e1e', '#e03131', '#2f9e44', '#1971c2', '#f08c00'];
export const BG_QUICK = ['transparent', '#ffc9c9', '#b2f2bb', '#a5d8ff', '#ffec99'];

const isHex = (s: string) => /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s.trim());
const normHex = (s: string) => {
  let h = s.trim().replace(/^#/, '').toLowerCase();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return `#${h}`;
};

export function Swatch({ color, active, onClick, label, large, testId }: { color: string | null; active?: boolean; onClick: () => void; label: string; large?: boolean; testId?: string }) {
  const cls = color === null ? 'sb-swatch--mixed' : color === 'transparent' ? 'sb-swatch--transparent' : '';
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      data-testid={testId}
      className={`sb-swatch ${large ? 'sb-swatch--lg' : ''} ${cls} ${active ? 'is-active' : ''}`}
      style={color && color !== 'transparent' ? { background: color } : undefined}
      onClick={onClick}
    />
  );
}

function PickerPopover({ anchor, value, onChange, onClose, allowTransparent, title }: {
  anchor: HTMLElement | null; value: string | null; onChange: (c: string) => void; onClose: () => void; allowTransparent: boolean; title: string;
}) {
  const [hex, setHex] = useState(value && value !== 'transparent' ? value.replace('#', '') : '');
  const narrow = useIsNarrow();
  const hues = Object.entries(PALETTE);
  const v = value?.toLowerCase();
  return (
    <Popover anchor={anchor} onClose={onClose} side={narrow ? 'top' : 'left'} align="start" offset={14} label={`${title} color picker`}>
      <div style={{ padding: 12, width: 236 }} data-testid="color-picker">
        <div className="sb-panel__label">Colors</div>
        <div className="flex gap-1.5" style={{ marginBottom: 8 }}>
          {allowTransparent && <Swatch color="transparent" label="Transparent" active={v === 'transparent'} onClick={() => onChange('transparent')} />}
          <Swatch color="#1e1e1e" label="Black" active={v === '#1e1e1e'} onClick={() => onChange('#1e1e1e')} />
          <Swatch color="#ffffff" label="White" active={v === '#ffffff'} onClick={() => onChange('#ffffff')} />
        </div>
        <div
          role="grid"
          aria-label="Palette"
          style={{ display: 'grid', gridTemplateColumns: `repeat(${hues.length}, 1fr)`, gridAutoFlow: 'column', gridTemplateRows: 'repeat(5, 1fr)', gap: 3 }}
        >
          {hues.flatMap(([name, shades]) =>
            shades.map((c, i) => (
              <button
                key={c}
                type="button"
                aria-label={`${name} ${i + 1}`}
                title={c}
                className={`sb-swatch ${v === c ? 'is-active' : ''}`}
                style={{ background: c, width: 15, height: 15, borderRadius: 3 }}
                onClick={() => onChange(c)}
              />
            )),
          )}
        </div>
        <div className="sb-panel__label" style={{ marginTop: 12 }}>Hex code</div>
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => { e.preventDefault(); if (isHex(hex)) onChange(normHex(hex)); }}
        >
          <div className="relative flex-1">
            <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-muted-2)', fontSize: 13 }}>#</span>
            <input
              className="sb-input sb-input--sm"
              aria-label="Hex color"
              data-testid="hex-input"
              style={{ paddingLeft: 20, fontFamily: 'var(--mono-font)' }}
              value={hex}
              maxLength={9}
              spellCheck={false}
              onChange={(e) => {
                const next = e.target.value.replace('#', '');
                setHex(next);
                if (isHex(next) && (next.length === 6 || next.length === 3)) onChange(normHex(next));
              }}
            />
          </div>
          <span className={`sb-swatch ${isHex(hex) ? '' : 'sb-swatch--transparent'}`} style={{ width: 28, height: 28, background: isHex(hex) ? normHex(hex) : undefined, cursor: 'default' }} />
        </form>
      </div>
    </Popover>
  );
}

/** Quick swatches + current color button opening the full picker. */
export function ColorSection({ title, quick, value, mixed, onChange, allowTransparent, testId }: {
  title: string; quick: string[]; value: string | null; mixed: boolean; onChange: (c: string) => void; allowTransparent: boolean; testId: string;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const v = mixed ? null : value?.toLowerCase() ?? null;
  return (
    <div className="flex items-center" style={{ gap: 4 }} data-testid={testId}>
      {quick.map((c) => (
        <Tooltip key={c} label={c === 'transparent' ? 'Transparent' : c} side="bottom">
          <Swatch color={c} label={`${title} ${c}`} active={v === c} onClick={() => onChange(c)} />
        </Tooltip>
      ))}
      <span className="sb-vdivider" style={{ height: 20, alignSelf: 'center' }} />
      <button
        ref={btn}
        type="button"
        aria-label={`${title} color: ${mixed ? 'mixed' : value}. Open color picker`}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-testid={`${testId}-picker`}
        className={`sb-swatch sb-swatch--lg ${mixed ? 'sb-swatch--mixed' : v === 'transparent' ? 'sb-swatch--transparent' : ''} ${open ? 'is-active' : ''}`}
        style={!mixed && v && v !== 'transparent' ? { background: v } : undefined}
        onClick={() => setOpen((o) => !o)}
      />
      {open && (
        <PickerPopover
          anchor={btn.current}
          value={v}
          title={title}
          allowTransparent={allowTransparent}
          onChange={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
