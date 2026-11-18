import { memo, useEffect, useRef, useState } from 'react';
import { BookOpen, Plus, Shapes, Trash } from 'lucide-react';
import { actions } from '@/services/actions';
import { useCanvasStore } from '@/store/canvasStore';
import { exportToSvg } from '@/engine/rendering';
import { useLibrary, type LibraryItem } from '../integration';
import { Tooltip } from '../ui/Tooltip';
import { confirmDialog } from '../ui/confirm';
import { closeDialog } from '../commands';
import { run } from '../run';
import { Drawer } from './Drawer';

const Thumb = memo(function Thumb({ item, theme }: { item: LibraryItem; theme: 'light' | 'dark' }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    try {
      const svg = exportToSvg(item.elements, useCanvasStore.getState().files, { padding: 8, background: null, theme });
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', '100%');
      host.replaceChildren(svg);
      setFailed(false);
    } catch {
      host.replaceChildren();
      setFailed(true);
    }
  }, [item, theme]);
  return (
    <div className="relative flex h-full w-full items-center justify-center" style={{ padding: 6, boxSizing: 'border-box', color: 'var(--color-muted-2)' }}>
      <div ref={ref} className="flex h-full w-full items-center justify-center" />
      {failed && <Shapes size={22} strokeWidth={1.4} className="absolute" />}
    </div>
  );
});

export function LibrarySidebar() {
  const { available, items, remove } = useLibrary();
  const theme = useCanvasStore((s) => s.appState.theme);
  const hasSelection = useCanvasStore((s) => Object.keys(s.appState.selectedElementIds).length > 0);

  return (
    <Drawer title="Library" icon={<BookOpen size={18} />} onClose={closeDialog} testId="library-sidebar">
      <div className="flex items-center gap-2" style={{ padding: '0 16px 12px' }}>
        <button
          type="button"
          className="sb-btn sb-btn--primary sb-btn--sm"
          disabled={!hasSelection}
          data-testid="library-add-selected"
          onClick={() => run(() => actions.addSelectionToLibrary(), { success: 'Added to library' })}
        >
          <Plus size={15} /> Add selected
        </button>
        <span style={{ font: '400 12px var(--ui-font)', color: 'var(--color-muted)' }}>{items.length} item{items.length === 1 ? '' : 's'}</span>
      </div>
      <div className="sb-scroll flex-1 overflow-y-auto" style={{ padding: '0 16px 16px' }}>
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 text-center" style={{ padding: '48px 16px', color: 'var(--color-muted)', font: '400 14px/1.5 var(--ui-font)' }}>
            <div className="flex items-center justify-center" style={{ width: 56, height: 56, borderRadius: 28, background: 'var(--color-surface-high)', color: 'var(--color-primary)' }}>
              <Shapes size={26} strokeWidth={1.5} />
            </div>
            <strong style={{ color: 'var(--color-on-surface)', fontWeight: 600 }}>No items added yet…</strong>
            {available
              ? 'Select elements on the canvas and click "Add selected" to reuse them in any drawing.'
              : 'The library will be available soon.'}
          </div>
        ) : (
          <ul className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))', gap: 8, listStyle: 'none', margin: 0, padding: 0 }} data-testid="library-grid">
            {items.map((it) => (
              <li key={it.id} className="group relative" style={{ aspectRatio: '1', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface-lowest)' }}>
                <Tooltip label={it.name || 'Insert item'} className="flex h-full w-full">
                  <button
                    type="button"
                    className="h-full w-full rounded-lg hover:bg-[var(--color-surface-high)]"
                    style={{ border: 0, padding: 0, background: 'transparent', cursor: 'pointer' }}
                    aria-label={`Insert ${it.name || 'library item'}`}
                    onClick={() => run(() => actions.insertLibraryItem(it.id))}
                  >
                    <Thumb item={it} theme={theme} />
                  </button>
                </Tooltip>
                <button
                  type="button"
                  aria-label={`Remove ${it.name || 'item'} from library`}
                  className="sb-tool opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  style={{ position: 'absolute', top: 2, right: 2, width: 24, height: 24, background: 'var(--island-bg)', boxShadow: 'var(--island-shadow)', color: 'var(--color-danger-strong)' }}
                  onClick={async () => {
                    const ok = await confirmDialog({ title: 'Remove item', message: 'Remove this item from your library?', confirmLabel: 'Remove', danger: true });
                    if (ok) remove(it.id);
                  }}
                >
                  <Trash size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Drawer>
  );
}

