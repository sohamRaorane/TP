import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { X } from 'lucide-react';
import { selectors, useCanvasStore } from '@/store/canvasStore';
import { getCommonBounds } from '@/engine/transformations/bounds';
import type { SketchElement } from '@/types/appState';
import { setElementGeometry } from '../PropertiesPanel/elementOps';
import { panelVisibleSelector } from '../PropertiesPanel/PropertiesPanel';
import { closeDialog } from '../commands';
import { run } from '../run';

const fmt = (n: number) => (Math.abs(n) >= 1000 ? Math.round(n).toString() : (Math.round(n * 100) / 100).toString());

function NumField({ label, value, onCommit, disabled, suffix }: { label: string; value: number; onCommit: (v: number) => void; disabled?: boolean; suffix?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => setDraft(null), [value]);
  const commit = () => {
    if (draft === null) return;
    const v = Number(draft);
    setDraft(null);
    if (Number.isFinite(v) && v !== value) onCommit(v);
  };
  return (
    <label className="flex items-center gap-1.5" style={{ font: '500 12px var(--ui-font)', color: 'var(--color-muted)' }}>
      <span style={{ width: 14 }}>{label}</span>
      <input
        className="sb-input sb-input--sm"
        style={{ height: 26, padding: '0 6px', fontVariantNumeric: 'tabular-nums' }}
        inputMode="decimal"
        aria-label={label}
        data-testid={`stats-${label.toLowerCase()}`}
        disabled={disabled}
        value={draft ?? fmt(value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') { e.stopPropagation(); setDraft(null); (e.target as HTMLInputElement).blur(); }
        }}
      />
      {suffix && <span>{suffix}</span>}
    </label>
  );
}

const Row = ({ k, v }: { k: string; v: string | number }) => (
  <div className="flex justify-between" style={{ font: '400 12px/1.9 var(--ui-font)' }}>
    <span style={{ color: 'var(--color-muted)' }}>{k}</span>
    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v}</span>
  </div>
);

function ElementFields({ el }: { el: SketchElement }) {
  const edit = (c: Parameters<typeof setElementGeometry>[1]) => run(() => setElementGeometry(el, c));
  const locked = el.locked;
  return (
    <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 6 }}>
      <NumField label="X" value={el.x} disabled={locked} onCommit={(x) => edit({ x })} />
      <NumField label="Y" value={el.y} disabled={locked} onCommit={(y) => edit({ y })} />
      <NumField label="W" value={el.width} disabled={locked} onCommit={(w) => w > 0 && edit({ width: w })} />
      <NumField label="H" value={el.height} disabled={locked} onCommit={(h) => h > 0 && edit({ height: h })} />
      <NumField label="A" value={(el.angle * 180) / Math.PI} disabled={locked} suffix="°" onCommit={(deg) => edit({ angle: (((deg % 360) + 360) % 360) * (Math.PI / 180) })} />
    </div>
  );
}

export function StatsPanel() {
  const count = useCanvasStore((s) => s.elements.reduce((n, e) => n + (e.isDeleted ? 0 : 1), 0));
  const selected = useCanvasStore(useShallow(selectors.selectedElements));
  const zoom = useCanvasStore((s) => s.appState.zoom);
  const sceneNonce = useCanvasStore((s) => s.sceneNonce);
  const propsVisible = useCanvasStore(panelVisibleSelector);
  const [sceneSize, setSceneSize] = useState('0 × 0');

  // scene bounds are O(n); recompute at most every 250ms
  useEffect(() => {
    const t = setTimeout(() => {
      const b = getCommonBounds(useCanvasStore.getState().elements);
      setSceneSize(b ? `${Math.round(b.maxX - b.minX)} × ${Math.round(b.maxY - b.minY)}` : '0 × 0');
    }, 250);
    return () => clearTimeout(t);
  }, [sceneNonce]);

  const selBounds = selected.length > 1 ? getCommonBounds(selected) : null;

  return (
    <section
      className="sb-island sb-pe absolute sb-scroll"
      style={{ right: propsVisible ? 240 : 16, bottom: 64, width: 228, padding: '10px 12px 12px', maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}
      aria-label="Stats"
      data-testid="stats-panel"
    >
      <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
        <h3 style={{ margin: 0, font: '700 14px var(--ui-font)' }}>Stats</h3>
        <button type="button" className="sb-tool" style={{ width: 26, height: 26 }} aria-label="Close stats" onClick={closeDialog}><X size={15} /></button>
      </div>
      <div className="sb-panel__label" style={{ marginTop: 6, marginBottom: 0 }}>Scene</div>
      <Row k="Elements" v={count} />
      <Row k="Selected" v={selected.length} />
      <Row k="Scene size" v={sceneSize} />
      <Row k="Zoom" v={`${Math.round(zoom * 100)}%`} />
      {selected.length === 1 && (
        <>
          <div className="sb-hdivider" style={{ margin: '8px 0' }} />
          <div className="sb-panel__label" style={{ textTransform: 'capitalize' }}>{selected[0].type}{selected[0].locked ? ' · locked' : ''}</div>
          <ElementFields el={selected[0]} />
        </>
      )}
      {selBounds && (
        <>
          <div className="sb-hdivider" style={{ margin: '8px 0' }} />
          <div className="sb-panel__label">Selection</div>
          <Row k="Position" v={`${fmt(selBounds.minX)}, ${fmt(selBounds.minY)}`} />
          <Row k="Size" v={`${fmt(selBounds.maxX - selBounds.minX)} × ${fmt(selBounds.maxY - selBounds.minY)}`} />
        </>
      )}
    </section>
  );
}
