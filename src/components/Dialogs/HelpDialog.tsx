import { useMemo } from 'react';
import { Command, Keyboard, Sparkles } from 'lucide-react';
import { Dialog } from '../ui/Dialog';
import { isMac } from '../ui/portal';
import { buildCommands, closeDialog, openDialog, type Command as Cmd } from '../commands';

const keyLabel = (k: string) => {
  if (!isMac) return k;
  return ({ Ctrl: '⌘', Shift: '⇧', Alt: '⌥' } as Record<string, string>)[k] ?? k;
};

/** "Ctrl+Shift+Z" -> chips; "V or 1" -> alternatives. */
export function Shortcut({ value }: { value: string }) {
  const alts = value.split(' or ');
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1">
      {alts.map((alt, i) => (
        <span key={alt} className="inline-flex items-center gap-1">
          {i > 0 && <span style={{ color: 'var(--color-muted)', fontSize: 12, margin: '0 2px' }}>or</span>}
          {alt.split(/\+(?!$)/).map((k) => <kbd key={k} className="sb-kbd">{keyLabel(k)}</kbd>)}
        </span>
      ))}
    </span>
  );
}

const EXTRA: Record<string, Array<{ label: string; shortcut: string }>> = {
  Tools: [
    { label: 'Add text / edit label', shortcut: 'Enter' },
    { label: 'Constrain proportions / angle', shortcut: 'Shift' },
    { label: 'Disable snapping while dragging', shortcut: 'Alt' },
  ],
  View: [
    { label: 'Pan canvas', shortcut: 'Space+Drag' },
    { label: 'Zoom with wheel', shortcut: 'Ctrl+Wheel' },
    { label: 'Clear selection / exit', shortcut: 'Escape' },
  ],
  Editor: [{ label: 'Move selection', shortcut: '↑ or ↓ or ← or →' }],
};

function Group({ title, rows }: { title: string; rows: Array<{ label: string; shortcut: string }> }) {
  return (
    <section style={{ border: '1px solid var(--color-border)', borderRadius: 10, padding: '10px 14px', breakInside: 'avoid', marginBottom: 14 }}>
      <h3 style={{ margin: '2px 0 8px', font: '700 15px var(--ui-font)' }}>{title}</h3>
      <dl style={{ margin: 0 }}>
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-3" style={{ padding: '5px 0', borderTop: '1px solid var(--color-border)' }}>
            <dt style={{ font: '400 13px/1.3 var(--ui-font)' }}>{r.label}</dt>
            <dd style={{ margin: 0 }}><Shortcut value={r.shortcut} /></dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function HelpDialog() {
  const groups = useMemo(() => {
    const cmds = buildCommands().filter((c): c is Cmd & { shortcut: string } => !!c.shortcut);
    const pick = (cats: Cmd['category'][]) => cmds.filter((c) => cats.includes(c.category)).map((c) => ({ label: c.label, shortcut: c.shortcut }));
    return [
      { title: 'Tools', rows: [...pick(['Tools']), ...EXTRA.Tools] },
      { title: 'View', rows: [...pick(['View', 'Help']), ...EXTRA.View] },
      { title: 'Editor', rows: [...pick(['Editor', 'File', 'Collaboration']), ...EXTRA.Editor] },
    ];
  }, []);

  return (
    <Dialog title="Help" onClose={closeDialog} width={980} testId="help-dialog">
      <div className="sb-dialog__body sb-scroll">
        <div className="flex flex-wrap gap-2" style={{ marginBottom: 18 }}>
          <button type="button" className="sb-btn sb-btn--outline sb-btn--sm" onClick={() => openDialog('commandPalette')}>
            <Command size={14} /> Command palette
          </button>
          <button type="button" className="sb-btn sb-btn--outline sb-btn--sm" onClick={() => openDialog('textToDiagram')}>
            <Sparkles size={14} /> Text to diagram
          </button>
        </div>
        <h3 className="flex items-center gap-2" style={{ margin: '0 0 12px', font: '700 16px var(--ui-font)' }}>
          <Keyboard size={18} /> Keyboard shortcuts
        </h3>
        <div style={{ columnWidth: 290, columnGap: 14 }}>
          {groups.map((g) => <Group key={g.title} title={g.title} rows={g.rows} />)}
        </div>
      </div>
    </Dialog>
  );
}
