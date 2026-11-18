import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { Dialog } from '../ui/Dialog';
import { kbd } from '../ui/portal';
import { buildCommands, closeDialog, type Command } from '../commands';

/** Subsequence fuzzy score; higher is better, -1 = no match. */
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  const t = text.toLowerCase();
  const idx = t.indexOf(q);
  if (idx >= 0) return 1000 - idx * 2 - (t.length - q.length) * 0.1 + (idx === 0 || t[idx - 1] === ' ' ? 200 : 0);
  let score = 0;
  let ti = 0;
  let streak = 0;
  for (const ch of q) {
    if (ch === ' ') continue;
    const found = t.indexOf(ch, ti);
    if (found < 0) return -1;
    streak = found === ti ? streak + 1 : 0;
    score += 10 + streak * 5 - (found - ti);
    if (found === 0 || t[found - 1] === ' ') score += 15;
    ti = found + 1;
  }
  return score;
}

export function CommandPalette() {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const all = useMemo(() => buildCommands(), []);

  const results = useMemo(() => {
    if (!query.trim()) return all;
    return all
      .map((c) => ({ c, s: Math.max(fuzzyScore(query, c.label), fuzzyScore(query, `${c.category} ${c.keywords ?? ''}`) - 50) }))
      .filter((r) => r.s >= 0)
      .sort((a, b) => b.s - a.s)
      .map((r) => r.c);
  }, [all, query]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const exec = (c: Command | undefined) => {
    if (!c || (c.enabled && !c.enabled())) return;
    closeDialog();
    // run after the dialog closes so commands that open dialogs aren't overridden
    queueMicrotask(c.run);
  };

  // Group headers only when not searching.
  let lastCat = '';
  return (
    <Dialog title="Command palette" onClose={closeDialog} width={620} bare align="top" testId="command-palette" initialFocus="input">
      <div className="flex items-center gap-2" style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--color-border)' }}>
        <Search size={18} style={{ color: 'var(--color-muted)' }} />
        <input
          className="flex-1"
          style={{ border: 0, outline: 'none', background: 'transparent', font: '400 16px var(--ui-font)', color: 'var(--color-on-surface)', height: 32 }}
          placeholder="Search menus, actions, and tools…"
          aria-label="Search commands"
          role="combobox"
          aria-expanded="true"
          aria-controls="sb-cmd-list"
          aria-activedescendant={results[active] ? `sb-cmd-${results[active].id}` : undefined}
          data-testid="command-palette-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            if (e.key === 'Enter') { e.preventDefault(); exec(results[active]); }
          }}
        />
        <kbd className="sb-kbd">Esc</kbd>
      </div>
      <div ref={list} id="sb-cmd-list" role="listbox" aria-label="Commands" className="sb-scroll" style={{ maxHeight: '52vh', overflowY: 'auto', padding: 8 }}>
        {results.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-muted)', font: '400 14px var(--ui-font)' }}>No matching commands</div>
        )}
        {results.map((c, i) => {
          const header = !query.trim() && c.category !== lastCat ? c.category : null;
          lastCat = c.category;
          const disabled = !!c.enabled && !c.enabled();
          return (
            <div key={c.id}>
              {header && <div className="sb-menu-group-label" style={{ paddingTop: i ? 12 : 4, fontWeight: 600 }}>{header}</div>}
              <div
                id={`sb-cmd-${c.id}`}
                role="option"
                aria-selected={i === active}
                aria-disabled={disabled}
                data-index={i}
                className="flex items-center gap-3"
                style={{
                  height: 36, padding: '0 12px', borderRadius: 6, cursor: disabled ? 'default' : 'pointer',
                  background: i === active ? 'var(--color-primary-light)' : 'transparent',
                  color: i === active ? 'var(--button-active-icon)' : 'var(--color-on-surface)',
                  opacity: disabled ? 0.45 : 1, font: '400 14px var(--ui-font)',
                }}
                onPointerMove={() => i !== active && setActive(i)}
                onClick={() => exec(c)}
              >
                <span className="flex-1 truncate">{c.label}</span>
                {query.trim() && <span style={{ fontSize: 12, color: 'var(--color-muted-2)' }}>{c.category}</span>}
                {c.shortcut && <span style={{ fontSize: 12, color: 'var(--color-muted-2)', minWidth: 60, textAlign: 'right' }}>{kbd(c.shortcut)}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}
