import { memo, useRef } from 'react';
import { ImagePlus, Lock, LockOpen } from 'lucide-react';
import { actions } from '@/services/actions';
import { useCanvasStore } from '@/store/canvasStore';
import { EXTRA_TOOLS, MAIN_TOOLS, setTool, toggles, toolShortcut, type ToolDef } from '../commands';
import { IconButton } from '../ui/IconButton';
import { useIsNarrow } from '../ui/useMedia';
import { run } from '../run';

const Divider = ({ narrow }: { narrow: boolean }) => (
  <div
    className="sb-tool-divider"
    aria-hidden
    style={narrow ? { width: 1, height: 24, margin: '0 2px' } : { height: 1, width: 24, margin: '2px auto' }}
    data-divider
  >
    <div style={{ width: '100%', height: '100%', background: 'var(--color-border)' }} />
  </div>
);

const ToolBtn = memo(function ToolBtn({ t, active, narrow }: { t: ToolDef; active: boolean; narrow: boolean }) {
  const Icon = t.icon;
  return (
    <IconButton
      label={t.label}
      shortcut={toolShortcut(t)}
      icon={<Icon size={17} strokeWidth={1.75} />}
      active={active}
      keyHint={t.num ?? t.key}
      side={narrow ? 'top' : 'right'}
      role="radio"
      aria-checked={active}
      data-testid={`tool-${t.type}`}
      onClick={() => setTool(t.type)}
    />
  );
});

/** Left vertical drawing toolbar (horizontal at the bottom on narrow screens). */
export function Toolbar() {
  const activeTool = useCanvasStore((s) => s.appState.activeTool);
  const toolLocked = useCanvasStore((s) => s.appState.toolLocked);
  const narrow = useIsNarrow();
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div
      className="sb-toolbar-wrap absolute sb-pe"
      style={{ left: 16, top: '50%', transform: 'translateY(-50%)' }}
    >
      <div
        role="radiogroup"
        aria-label="Drawing tools"
        aria-orientation={narrow ? 'horizontal' : 'vertical'}
        className="sb-island sb-toolbar sb-scroll flex items-center"
        style={{ padding: 4, gap: 4, maxHeight: narrow ? undefined : 'calc(100vh - 160px)', overflowY: narrow ? undefined : 'auto' }}
        data-testid="toolbar"
      >
        <IconButton
          label={toolLocked ? 'Unlock tool' : 'Keep selected tool active after drawing'}
          shortcut="Q"
          icon={toolLocked ? <Lock size={16} /> : <LockOpen size={16} />}
          active={toolLocked}
          aria-pressed={toolLocked}
          side={narrow ? 'top' : 'right'}
          data-testid="tool-lock"
          onClick={toggles.toolLock}
        />
        <Divider narrow={narrow} />
        {MAIN_TOOLS.map((t) => (
          <ToolBtn key={t.type} t={t} active={activeTool === t.type} narrow={narrow} />
        ))}
        <Divider narrow={narrow} />
        {EXTRA_TOOLS.map((t) => (
          <ToolBtn key={t.type} t={t} active={activeTool === t.type} narrow={narrow} />
        ))}
      </div>

      {/* Fallback image picker while the image tool is active. */}
      {activeTool === 'image' && (
        <div
          className="sb-island absolute flex items-center"
          style={narrow ? { bottom: 'calc(100% + 8px)', left: 0, padding: 4 } : { left: 'calc(100% + 8px)', top: '50%', padding: 4 }}
        >
          <button type="button" className="sb-btn sb-btn--ghost sb-btn--sm" onClick={() => fileRef.current?.click()}>
            <ImagePlus size={16} /> Choose image…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            data-testid="image-file-input"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) run(async () => { await actions.insertImage(f); setTool('selection'); });
            }}
          />
        </div>
      )}
    </div>
  );
}
