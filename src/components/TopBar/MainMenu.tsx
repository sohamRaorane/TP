import { useRef } from 'react';
import {
  ClockArrowLeft, Command, Download, FilePlus, FileUp, FolderOpen, Moon, Presentation, Save, Sparkles,
  Sun, Trash, Users, CircleQuestionMark, FileDown,
} from 'lucide-react';
import { actions } from '@/services/actions';
import { useCanvasStore } from '@/store/canvasStore';
import { Menu, MenuItem, MenuSeparator } from '../ui/Menu';
import { Popover } from '../ui/Popover';
import { confirmDialog } from '../ui/confirm';
import { kbd } from '../ui/portal';
import { openDialog, toggles } from '../commands';
import { run, setUi } from '../run';

export const CANVAS_BACKGROUNDS_LIGHT = ['#ffffff', '#f8f9fa', '#f5faff', '#fffce8', '#fdf8f6'];
export const CANVAS_BACKGROUNDS_DARK = ['#121212', '#161718', '#13171c', '#181605', '#1b1615'];

export function CanvasBackgroundPicker() {
  const bg = useCanvasStore((s) => s.appState.viewBackgroundColor);
  const theme = useCanvasStore((s) => s.appState.theme);
  const list = theme === 'dark' ? CANVAS_BACKGROUNDS_DARK : CANVAS_BACKGROUNDS_LIGHT;
  return (
    <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Canvas background">
      {list.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={bg.toLowerCase() === c}
          aria-label={`Canvas background ${c}`}
          className={`sb-swatch sb-swatch--lg ${bg.toLowerCase() === c ? 'is-active' : ''}`}
          style={{ background: c }}
          onClick={() => setUi({ viewBackgroundColor: c })}
        />
      ))}
    </div>
  );
}

export function MainMenu({ anchor, onClose }: { anchor: HTMLElement | null; onClose: () => void }) {
  const theme = useCanvasStore((s) => s.appState.theme);
  const hasDrawing = useCanvasStore((s) => !!s.appState.drawingId);
  const fileRef = useRef<HTMLInputElement>(null);
  const pick = (fn: () => void) => () => { onClose(); fn(); };

  return (
    <Popover anchor={anchor} onClose={onClose} side="bottom" align="start" role="presentation">
      <Menu label="Main menu" className="sb-scroll" >
        <div style={{ maxHeight: 'calc(100vh - 90px)', overflowY: 'auto', width: 240 }} className="sb-scroll" data-testid="main-menu">
          <MenuItem icon={<FolderOpen size={16} />} label="Open" shortcut={kbd('Ctrl+O')} onSelect={pick(() => openDialog('dashboard'))} testId="menu-open" />
          <MenuItem icon={<FilePlus size={16} />} label="New drawing" onSelect={pick(() => run(() => actions.newDrawing()))} />
          <MenuItem icon={<Save size={16} />} label="Save now" shortcut={kbd('Ctrl+S')} onSelect={pick(() => run(() => actions.saveNow(), { success: 'Saved' }))} />
          <MenuItem icon={<FileUp size={16} />} label="Open file…" onSelect={() => fileRef.current?.click()} />
          <MenuItem icon={<FileDown size={16} />} label="Save to file" onSelect={pick(() => run(() => actions.exportJSON()))} />
          <MenuItem icon={<Download size={16} />} label="Export image…" shortcut={kbd('Ctrl+Shift+E')} onSelect={pick(() => openDialog('export'))} />
          <MenuItem icon={<Users size={16} />} label="Live collaboration…" onSelect={pick(() => openDialog('share'))} />
          <MenuItem icon={<Command size={16} />} label="Command palette" shortcut={kbd('Ctrl+/')} onSelect={pick(() => openDialog('commandPalette'))} />
          <MenuItem icon={<ClockArrowLeft size={16} />} label="Version history" disabled={!hasDrawing} onSelect={pick(() => openDialog('versions'))} />
          <MenuItem icon={<Sparkles size={16} />} label="Text to diagram…" onSelect={pick(() => openDialog('textToDiagram'))} />
          <MenuItem icon={<Presentation size={16} />} label="Present frames" onSelect={pick(() => run(() => actions.startPresentation()))} />
          <MenuItem icon={<CircleQuestionMark size={16} />} label="Help" shortcut="?" onSelect={pick(() => openDialog('help'))} />
          <MenuItem
            icon={<Trash size={16} />}
            label="Reset the canvas"
            danger
            onSelect={pick(async () => {
              const ok = await confirmDialog({
                title: 'Clear canvas',
                message: 'This will clear the whole canvas. Are you sure?',
                confirmLabel: 'Clear',
                danger: true,
              });
              if (ok) run(() => actions.clearCanvas());
            })}
          />
          <MenuSeparator />
          <MenuItem
            icon={theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            label={theme === 'dark' ? 'Light mode' : 'Dark mode'}
            shortcut={kbd('Alt+Shift+D')}
            onSelect={toggles.theme}
            testId="menu-theme"
          />
          <MenuSeparator />
          <div className="sb-menu-group-label">Canvas background</div>
          <div style={{ padding: '4px 10px 6px' }}>
            <CanvasBackgroundPicker />
          </div>
        </div>
      </Menu>
      <input
        ref={fileRef}
        type="file"
        hidden
        accept=".json,.sketchboard,application/json,image/*"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          onClose();
          if (f) run(() => actions.importFile(f));
        }}
      />
    </Popover>
  );
}
